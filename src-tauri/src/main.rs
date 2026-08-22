#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{DateTime, Duration as ChronoDuration, Local, Timelike};
use serde::Serialize;
use serde_json::{json, Value};
use std::{thread, time::Duration};
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_store::StoreExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Point {
    x: i32,
    y: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PresenceSnapshot {
    cursor: Point,
    idle_ms: u32,
    local_hour: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DueEvent {
    id: String,
    kind: String,
    title: String,
    details: String,
    scheduled_at: String,
}

fn parse_time(value: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(value).ok().map(|date| date.with_timezone(&Local))
}

fn local_day_key(now: DateTime<Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

fn increment_revision(data: &mut Value) {
    let revision = data.get("revision").and_then(Value::as_i64).unwrap_or(1) + 1;
    if let Some(object) = data.as_object_mut() {
        object.insert("revision".into(), json!(revision));
    }
}

fn persist_and_emit(app: &tauri::AppHandle, data: Value) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    store.set("pet-data", data.clone());
    store.save().map_err(|error| error.to_string())?;
    let _ = app.emit("pet-data-updated", data.clone());
    Ok(data)
}

fn update_hidden_state(app: &tauri::AppHandle, hidden: bool) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    let mut data = store.get("pet-data").ok_or_else(|| "pet-data is missing".to_string())?;
    if let Some(object) = data.as_object_mut() { object.insert("hidden".into(), json!(hidden)); }
    increment_revision(&mut data);
    persist_and_emit(app, data)
}

#[tauri::command]
fn set_pet_hidden(app: tauri::AppHandle, hidden: bool) -> Result<Value, String> {
    update_hidden_state(&app, hidden)
}

fn should_accept_incoming(current: &Value, incoming: &Value) -> bool {
    let current_revision = current.get("revision").and_then(Value::as_i64).unwrap_or(1);
    let incoming_revision = incoming.get("revision").and_then(Value::as_i64).unwrap_or(0);
    incoming_revision > current_revision
}

#[tauri::command]
fn save_pet_data(app: tauri::AppHandle, data: Value) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    if let Some(current) = store.get("pet-data") {
        if !should_accept_incoming(&current, &data) {
            return Ok(current);
        }
    }
    persist_and_emit(&app, data)
}

fn apply_organizer_acknowledgement(
    data: &mut Value,
    id: &str,
    action: &str,
    snooze_minutes: Option<i64>,
    now: DateTime<Local>,
) -> Result<(), String> {
    let items = data
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "items is missing".to_string())?;

    for item in items.iter_mut() {
        let Some(object) = item.as_object_mut() else { continue };
        if object.get("id").and_then(Value::as_str) != Some(id) { continue }
        let kind = object.get("type").and_then(Value::as_str).unwrap_or("").to_string();
        if kind == "note" { continue }
        if action == "snooze" {
            let minutes = snooze_minutes.unwrap_or(5).clamp(1, 120);
            let until = now + ChronoDuration::minutes(minutes);
            object.insert("status".into(), json!("snoozed"));
            object.insert("snoozedUntil".into(), json!(until.to_rfc3339()));
            object.insert("occurrenceKey".into(), Value::Null);
            if kind == "alarm" { object.insert("enabled".into(), json!(true)); }
        } else {
            object.insert("snoozedUntil".into(), Value::Null);
            if kind == "reminder" {
                object.insert("status".into(), json!("completed"));
            } else if object.get("schedule").and_then(Value::as_str) == Some("daily") {
                object.insert("status".into(), json!("pending"));
                object.insert("enabled".into(), json!(true));
                object.insert("occurrenceKey".into(), json!(format!("{}:{}", id, local_day_key(now))));
            } else {
                object.insert("status".into(), json!("dismissed"));
                object.insert("enabled".into(), json!(false));
            }
        }
        return Ok(())
    }

    Err(format!("organizer item not found: {id}"))
}

#[tauri::command]
fn update_pet_settings(app: tauri::AppHandle, settings: Value) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    let mut data = store.get("pet-data").ok_or_else(|| "pet-data is missing".to_string())?;
    data.as_object_mut()
        .ok_or_else(|| "pet-data is invalid".to_string())?
        .insert("settings".into(), settings);
    increment_revision(&mut data);
    persist_and_emit(&app, data)
}

#[tauri::command]
fn mutate_organizer_item(
    app: tauri::AppHandle,
    action: String,
    item: Option<Value>,
    id: Option<String>,
) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    let mut data = store.get("pet-data").ok_or_else(|| "pet-data is missing".to_string())?;
    let items = data
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "items is missing".to_string())?;

    match action.as_str() {
        "add" => items.insert(0, item.ok_or_else(|| "item is required".to_string())?),
        "replace" => {
            let replacement = item.ok_or_else(|| "item is required".to_string())?;
            let replacement_id = replacement.get("id").and_then(Value::as_str).ok_or_else(|| "item id is required".to_string())?;
            let target = items.iter_mut().find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(replacement_id))
                .ok_or_else(|| format!("organizer item not found: {replacement_id}"))?;
            *target = replacement;
        }
        "remove" => {
            let target_id = id.ok_or_else(|| "id is required".to_string())?;
            let previous_len = items.len();
            items.retain(|candidate| candidate.get("id").and_then(Value::as_str) != Some(target_id.as_str()));
            if items.len() == previous_len { return Err(format!("organizer item not found: {target_id}")) }
        }
        _ => return Err(format!("unknown organizer action: {action}")),
    }

    increment_revision(&mut data);
    persist_and_emit(&app, data)
}

#[tauri::command]
fn acknowledge_organizer_item(
    app: tauri::AppHandle,
    id: String,
    action: String,
    snooze_minutes: Option<i64>,
) -> Result<Value, String> {
    let store = app.store("pet-data-v2.json").map_err(|error| error.to_string())?;
    let mut data = store.get("pet-data").ok_or_else(|| "pet-data is missing".to_string())?;
    let now = Local::now();
    apply_organizer_acknowledgement(&mut data, &id, &action, snooze_minutes, now)?;
    increment_revision(&mut data);
    store.set("pet-data", data.clone());
    store.save().map_err(|error| error.to_string())?;
    let _ = app.emit("pet-data-updated", data.clone());
    let _ = app.emit("alert-resolved", json!({ "id": id, "action": action, "data": data.clone() }));
    Ok(data)
}

fn scheduler_tick(app: &tauri::AppHandle) {
    let Ok(store) = app.store("pet-data-v2.json") else { return };
    let Some(mut data) = store.get("pet-data") else { return };
    let Some(items) = data.get_mut("items").and_then(Value::as_array_mut) else { return };
    let now = Local::now();
    let mut due_events = Vec::new();

    for item in items.iter_mut() {
        let Some(object) = item.as_object_mut() else { continue };
        let kind = object.get("type").and_then(Value::as_str).unwrap_or("").to_string();
        if kind != "alarm" && kind != "reminder" { continue }
        let status = object.get("status").and_then(Value::as_str).unwrap_or("pending");
        if matches!(status, "completed" | "dismissed" | "missed") { continue }
        if kind == "alarm" && !object.get("enabled").and_then(Value::as_bool).unwrap_or(true) { continue }

        let id = object.get("id").and_then(Value::as_str).unwrap_or("").to_string();
        let scheduled_at = object.get("scheduledAt").and_then(Value::as_str).unwrap_or("").to_string();
        let snoozed_until = object.get("snoozedUntil").and_then(Value::as_str).map(str::to_string);
        let is_daily = kind == "alarm" && object.get("schedule").and_then(Value::as_str) == Some("daily");
        let (should_trigger, occurrence_key) = if let Some(snooze) = snoozed_until.as_deref() {
            (parse_time(snooze).is_some_and(|date| now >= date), format!("{id}:{snooze}"))
        } else if is_daily {
            let should = parse_time(&scheduled_at).is_some_and(|scheduled| {
                (now.hour(), now.minute()) >= (scheduled.hour(), scheduled.minute())
            });
            (should, format!("{}:{}", id, now.format("%Y-%m-%d")))
        } else {
            (parse_time(&scheduled_at).is_some_and(|date| now >= date), format!("{id}:{scheduled_at}"))
        };
        if !should_trigger || object.get("occurrenceKey").and_then(Value::as_str) == Some(occurrence_key.as_str()) { continue }

        let title = if kind == "alarm" {
            object.get("label").and_then(Value::as_str).unwrap_or("Alarm")
        } else {
            object.get("title").and_then(Value::as_str).unwrap_or("Hatırlatma")
        }.to_string();
        let details = if kind == "alarm" {
            "Alarm zamanı".to_string()
        } else {
            object.get("details").and_then(Value::as_str).unwrap_or("").to_string()
        };
        due_events.push(DueEvent { id: id.clone(), kind: kind.clone(), title, details, scheduled_at: snoozed_until.unwrap_or(scheduled_at) });
        object.insert("status".into(), json!("pending"));
        object.insert("snoozedUntil".into(), Value::Null);
        object.insert("lastTriggeredAt".into(), json!(now.to_rfc3339()));
        object.insert("occurrenceKey".into(), json!(occurrence_key));
        if kind == "alarm" && !is_daily { object.insert("enabled".into(), json!(false)); }
    }

    if due_events.is_empty() { return }
    increment_revision(&mut data);
    store.set("pet-data", data.clone());
    let _ = store.save();
    let _ = app.emit("pet-data-updated", data);
    for event in due_events { let _ = app.emit_to("main", "scheduler-due", event); }
}

#[cfg(windows)]
#[tauri::command]
fn presence_snapshot() -> PresenceSnapshot {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    let mut input = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        GetCursorPos(&mut point);
        GetLastInputInfo(&mut input);
    }
    let idle_ms = unsafe { GetTickCount() }.wrapping_sub(input.dwTime);
    PresenceSnapshot { cursor: Point { x: point.x, y: point.y }, idle_ms, local_hour: Local::now().hour() }
}

#[cfg(not(windows))]
#[tauri::command]
fn presence_snapshot() -> PresenceSnapshot {
    PresenceSnapshot { cursor: Point { x: 0, y: 0 }, idle_ms: 0, local_hour: Local::now().hour() }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--autostart"]).build())
        .invoke_handler(tauri::generate_handler![
            presence_snapshot,
            save_pet_data,
            update_pet_settings,
            mutate_organizer_item,
            acknowledge_organizer_item,
            set_pet_hidden
        ])
        .setup(|app| {
            let show_pet = MenuItemBuilder::with_id("show-pet", "Peti göster").build(app)?;
            let hide_pet = MenuItemBuilder::with_id("hide-pet", "Peti gizle").build(app)?;
            let manager = MenuItemBuilder::with_id("manager", "Kontrol merkezi").build(app)?;
            let pause = MenuItemBuilder::with_id("pause", "Hareketi duraklat").build(app)?;
            let mute = MenuItemBuilder::with_id("mute", "Sesleri kapat").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Çıkış").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show_pet, &hide_pet, &manager, &pause, &mute, &quit]).build()?;
            let tray_icon = app.default_window_icon().expect("configured application icon is missing").clone();
            TrayIconBuilder::with_id("pet-tray")
                .icon(tray_icon)
                .tooltip("Masaüstü Dostum")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show-pet" => { let _ = update_hidden_state(app, false); if let Some(window) = app.get_webview_window("main") { let _ = window.show(); } }
                    "hide-pet" => { if let Some(window) = app.get_webview_window("main") { let _ = window.emit("pet-action", serde_json::json!({ "action": "hide-pet" })); } }
                    "manager" => { if let Some(window) = app.get_webview_window("assistant") { let _ = window.show(); let _ = window.set_focus(); } }
                    "pause" => { if let Some(window) = app.get_webview_window("main") { let _ = window.emit("pet-action", serde_json::json!({ "action": "toggle-pin" })); } }
                    "mute" => { if let Some(window) = app.get_webview_window("main") { let _ = window.emit("tray-toggle-mute", ()); } }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            let scheduler_app = app.handle().clone();
            thread::spawn(move || loop {
                scheduler_tick(&scheduler_app);
                thread::sleep(Duration::from_secs(1));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running connected desktop pets");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_time(value: &str) -> DateTime<Local> {
        DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&Local)
    }

    #[test]
    fn stale_full_document_save_cannot_overwrite_newer_store_data() {
        let current = json!({"revision": 12, "settings": {"petSize": "tiny"}});
        let stale = json!({"revision": 12, "settings": {"petSize": "large"}});
        let newer = json!({"revision": 13, "settings": {"petSize": "small"}});
        assert!(!should_accept_incoming(&current, &stale));
        assert!(should_accept_incoming(&current, &newer));
    }

    #[test]
    fn reminder_done_and_snooze_are_idempotent_data_transitions() {
        let mut data = json!({"items": [{"id":"r1","type":"reminder","status":"pending","snoozedUntil":null,"occurrenceKey":"r1:first"}]});
        let now = local_time("2026-08-22T12:00:00+03:00");
        apply_organizer_acknowledgement(&mut data, "r1", "snooze", Some(10), now).unwrap();
        assert_eq!(data["items"][0]["status"], "snoozed");
        assert_eq!(data["items"][0]["occurrenceKey"], Value::Null);
        apply_organizer_acknowledgement(&mut data, "r1", "dismiss", None, now).unwrap();
        assert_eq!(data["items"][0]["status"], "completed");
        assert_eq!(data["items"][0]["snoozedUntil"], Value::Null);
    }

    #[test]
    fn daily_alarm_dismiss_stops_today_without_disabling_tomorrow() {
        let mut data = json!({"items": [{"id":"a1","type":"alarm","schedule":"daily","enabled":true,"status":"pending","snoozedUntil":null,"occurrenceKey":null}]});
        let now = local_time("2026-08-22T12:00:00+03:00");
        apply_organizer_acknowledgement(&mut data, "a1", "dismiss", None, now).unwrap();
        assert_eq!(data["items"][0]["status"], "pending");
        assert_eq!(data["items"][0]["enabled"], true);
        assert_eq!(data["items"][0]["occurrenceKey"], "a1:2026-08-22");
    }
}
