import { emitTo } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  LogicalPosition,
  LogicalSize,
  currentMonitor,
  getAllWindows,
  getCurrentWindow
} from '@tauri-apps/api/window';
import type { Bounds, BubbleFollow, BubbleMessage, PopoverMessage, Vector2 } from './types';

const FLOOR_MARGIN = 10;
const isTauriRuntime = (): boolean => '__TAURI_INTERNALS__' in window;

export interface PresenceSnapshot {
  cursor: Vector2;
  idleMs: number;
  localHour: number;
}

export class DesktopWindow {
  private readonly appWindow = isTauriRuntime() ? getCurrentWindow() : null;
  private windowSize = 112;
  private bounds: Bounds = { minX: 0, maxX: Math.max(0, innerWidth - 112), minY: 0, maxY: Math.max(0, innerHeight - 112) };
  private browserCursor: Vector2 = { x: innerWidth / 2, y: innerHeight / 2 };
  private lastBrowserInputAt = Date.now();

  constructor() {
    if (!this.appWindow) {
      const recordInput = (event: PointerEvent): void => {
        this.browserCursor = { x: event.clientX, y: event.clientY };
        this.lastBrowserInputAt = Date.now();
      };
      window.addEventListener('pointermove', recordInput, { passive: true });
      window.addEventListener('keydown', () => { this.lastBrowserInputAt = Date.now(); }, { passive: true });
    }
  }

  async initialize(size = 112): Promise<void> {
    this.windowSize = size;
    if (!this.appWindow) { this.refreshBrowserBounds(); return; }
    await this.appWindow.setSize(new LogicalSize(size, size));
    await this.appWindow.setAlwaysOnTop(true);
    await this.appWindow.setSkipTaskbar(true);
    await this.appWindow.setDecorations(false);
    await this.appWindow.setShadow(false);
    await this.refreshBounds();
  }

  async resize(size: number): Promise<void> {
    this.windowSize = size;
    await this.appWindow?.setSize(new LogicalSize(size, size));
    await this.refreshBounds();
  }

  async refreshBounds(): Promise<Bounds> {
    if (!this.appWindow) { this.refreshBrowserBounds(); return this.bounds; }
    const monitor = await currentMonitor();
    if (!monitor) return this.bounds;
    const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
    const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
    this.bounds = {
      minX: position.x,
      maxX: position.x + Math.max(0, size.width - this.windowSize),
      minY: position.y,
      maxY: position.y + Math.max(0, size.height - this.windowSize - FLOOR_MARGIN)
    };
    return this.bounds;
  }

  getBounds(): Bounds { return { ...this.bounds }; }
  getWorkArea(): Bounds {
    return {
      minX: this.bounds.minX,
      minY: this.bounds.minY,
      maxX: this.bounds.maxX + this.windowSize,
      maxY: this.bounds.maxY + this.windowSize + FLOOR_MARGIN
    };
  }
  getSize(): number { return this.windowSize; }

  async getPosition(): Promise<Vector2> {
    if (!this.appWindow) return { x: 0, y: this.bounds.maxY };
    const position = await this.appWindow.outerPosition();
    const scale = await this.appWindow.scaleFactor();
    const logical = position.toLogical(scale);
    return { x: logical.x, y: logical.y };
  }

  async setPosition(position: Vector2): Promise<void> {
    await this.appWindow?.setPosition(new LogicalPosition(position.x, position.y));
  }

  async presence(): Promise<PresenceSnapshot> {
    if (!this.appWindow) return { cursor: { ...this.browserCursor }, idleMs: Date.now() - this.lastBrowserInputAt, localHour: new Date().getHours() };
    return invoke<PresenceSnapshot>('presence_snapshot');
  }

  isNative(): boolean { return this.appWindow !== null; }
  getLabel(): string { return this.appWindow?.label ?? 'browser'; }

  async showManager(focus = true): Promise<boolean> {
    return this.showWindow('assistant', focus);
  }

  async showPopover(message: PopoverMessage, anchor: Vector2): Promise<boolean> {
    if (!this.appWindow) return false;
    const windows = await getAllWindows();
    const popover = windows.find((candidate) => candidate.label === 'popover');
    if (!popover) return false;
    const width = 220;
    const height = message.type === 'menu' ? 300 : message.type === 'alert' ? 240 : message.action ? 150 : 116;
    await popover.setSize(new LogicalSize(width, height));
    const monitor = await currentMonitor();
    let area = this.bounds;
    if (monitor) {
      const position = monitor.workArea.position.toLogical(monitor.scaleFactor);
      const size = monitor.workArea.size.toLogical(monitor.scaleFactor);
      area = { minX: position.x, minY: position.y, maxX: position.x + size.width, maxY: position.y + size.height };
    }
    // Prefer the right of the pet; flip to the left when it would overflow the edge.
    let x = anchor.x + this.windowSize + 8;
    if (x + width > area.maxX) x = anchor.x - width - 8;
    x = Math.max(area.minX, Math.min(area.maxX - width, x));
    const y = Math.max(area.minY, Math.min(area.maxY - height, anchor.y - 28));
    await popover.setPosition(new LogicalPosition(x, y));
    await emitTo('popover', 'popover-message', message);
    await popover.show();
    return true;
  }

  async showBubble(message: BubbleMessage): Promise<boolean> {
    if (!this.appWindow) return false;
    const bubble = (await getAllWindows()).find((candidate) => candidate.label === 'bubble');
    if (!bubble) return false;
    await emitTo('bubble', 'bubble-message', message);
    return true;
  }

  async followBubble(message: BubbleFollow): Promise<void> {
    if (!this.appWindow) return;
    await emitTo('bubble', 'bubble-follow', message);
  }

  async hideWindow(label: string): Promise<void> {
    const target = (await getAllWindows()).find((candidate) => candidate.label === label);
    await target?.hide();
  }
  async hideCurrent(): Promise<void> { await this.appWindow?.hide(); }
  async hideInsteadOfClose(): Promise<void> {
    if (!this.appWindow) return;
    await this.appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await this.appWindow?.hide();
    });
  }

  private async showWindow(label: string, focus: boolean): Promise<boolean> {
    if (!this.appWindow) return false;
    const target = (await getAllWindows()).find((candidate) => candidate.label === label);
    if (!target) return false;
    await target.show(); if (focus) await target.setFocus(); return true;
  }
  private refreshBrowserBounds(): void {
    this.bounds = { minX: 0, maxX: Math.max(0, innerWidth - this.windowSize), minY: 0, maxY: Math.max(0, innerHeight - this.windowSize - FLOOR_MARGIN) };
  }
}
