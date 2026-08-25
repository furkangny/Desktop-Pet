# Desktop Pet · Masaüstü Dostum

A lively, local-first Windows and macOS desktop companion built with Tauri, TypeScript and Vite.
Tauri, TypeScript ve Vite ile geliştirilmiş, Windows ve macOS'ta yerel çalışan canlı bir masaüstü dostu.

[Türkçe](#türkçe) · [English](#english)

---

## Türkçe

### Proje hakkında

Desktop Pet, masaüstünüzün üzerinde yaşayan etkileşimli bir sanal dost uygulamasıdır. Pet; ekranın kullanılabilir alanında dolaşır, imleci takip eder, doğal biçimde dinlenir ve kullanıcı etkileşimlerine karakterine uygun animasyonlar ve seslerle karşılık verir.

Uygulama bulut hesabı gerektirmez. Pet ayarları, konumu, notlar, hatırlatıcılar, alarmlar ve etkileşim hafızası kullanıcının kendi bilgisayarında saklanır.

### Petler

- **Tiny Robot:** Tatlı robotik konuşma ve tepki seslerine sahip küçük robot.
- **Tiny Astronaut:** Kendine özgü düşük tonlu android sesleri olan minik astronot.
- **Pixel Cat:** Doğal kedi sesleri, mırlama, kendini temizleme ve özel kıvrılmış uyku pozuna sahip pixel kedi.

### Öne çıkan özellikler

- Şeffaf, çerçevesiz ve her zaman üstte kalan gerçek masaüstü penceresi
- Sabit, hibrit ve tüm masaüstünde serbest dolaşım modları
- Serbest modda Z derinliği, perspektif eğimi, dinamik ölçek ve temas gölgesiyle üç boyutlu dolaşım hissi
- Kedi için zemin yürüyüşü, doğal sıçrama, tırmanma ve konma; robot ve astronot için hover/itici geçişleri
- Doğal hızlanma, yavaşlama, yürüme ritmi, koşma ve bekleme davranışları
- Peti tutup sürükleme, sallama ve hızla fırlatma
- Ekran kenarlarına çarpma, sekme, savrulma ve sersemleme tepkileri
- Dans, uyku ve odaklanma komutları
- Enerji, neşe, rahatlık ve tahammül gibi zamanla değişen ihtiyaçlar
- Yorulma, kızma, neşelenme, merak etme, gözlemleme ve irkilme durumları
- Kedinin kendini temizlemesi ve petlerin kendiliğinden dinlenmesi gibi bağımsız davranışlar
- Robot ve astronot için droid tarzı; kedi için doğal ses tepkileri
- Peti gizleme ve Windows sistem tepsisi/macOS menü çubuğundan yeniden gösterme
- Düzenlenebilir notlar, tek seferlik hatırlatıcılar ve tek seferlik/günlük alarmlar
- Hatırlatıcıyı tamamlama veya erteleme
- Ayrı ses kanalları ve kanal bazında ses seviyesi kontrolleri
- Windows veya macOS açılışında otomatik başlatma seçeneği
- Pet adı, türü, boyutu, hareket yoğunluğu ve hareket modu ayarları
- Konuşma balonunun hareket eden peti takip etmesi
- Ayarların, organizatör verilerinin ve pet konumunun yerel olarak saklanması

### Son kullanıcı kurulumu

Son kullanıcıların Node.js veya Rust kurmasına gerek yoktur. Güncel Windows x64 kurulum paketleri doğrudan repoda bulunur:

- [Desktop Pet v0.3.0 — Windows Setup EXE](releases/v0.3.0/Desktop-Pet-0.3.0-Windows-x64-Setup.exe)
- [Desktop Pet v0.3.0 — Windows MSI](releases/v0.3.0/Desktop-Pet-0.3.0-Windows-x64.msi)
- [SHA-256 doğrulama değerleri](releases/v0.3.0/SHA256SUMS.txt)

Normal kullanıcılar için NSIS `setup.exe`, kurumsal veya yönetilen dağıtımlar için MSI paketi daha uygundur.

Bu dosyalar v0.3.0 kaynak kodundan üretilmiştir. Uykuya giriş ve uyanış sırasında metin balonu gösterilmez; kısa `zZ` göstergesi 3,5 saniye sonra kaybolur. Windows sistem tepsisi ikonu pakete dahildir.

> [!NOTE]
> Kurulum paketi kod imzalama sertifikasıyla imzalanmadıysa Windows SmartScreen “Bilinmeyen yayıncı” uyarısı gösterebilir.

#### macOS

Proje Apple Silicon ve Intel Mac'leri birlikte destekleyen Universal `.app` ve `.dmg` üretimine hazırdır. Her `main` push'unda ve manuel çalıştırmada **macOS Universal Build** GitHub Actions iş akışı gerçek bir macOS runner üzerinde testleri çalıştırır ve indirilebilir paketleri üretir:

- `Connected-Desktop-Pets-macOS-universal.dmg`
- `Connected-Desktop-Pets-macOS-universal.app.zip`
- `SHA256SUMS.txt`
- `BINARY-ARCHITECTURES.txt`

Paketi indirmek için GitHub deposunda **Actions → macOS Universal Build → son başarılı çalışma → Artifacts** yolunu izleyin. CI paketi ad-hoc imzalıdır; bu, Apple Silicon uygulamasının yapısal olarak imzalı olmasını sağlar ancak Apple notarizasyonunun yerini tutmaz. İnternetten indirilen test paketini ilk kez açarken macOS **Privacy & Security** ekranından izin vermek gerekebilir. Genel son kullanıcı dağıtımı için `Developer ID Application` sertifikası ve Apple notarizasyonu eklenmelidir.

### Kullanım

- Peti taşımak için üzerine basılı tutup sürükleyin.
- Fırlatmak için sürüklerken hız kazandırıp bırakın.
- Hızlı menüyü açmak için pete sağ tıklayın.
- Dans, uyku, odaklanma, sabitleme ve gizleme komutlarını hızlı menüden kullanın.
- Not, hatırlatıcı, alarm ve pet ayarları için **Kontrol merkezi**ni açın.
- Gizlenen peti geri getirmek için Windows sistem tepsisi veya macOS menü çubuğundaki pet simgesinden **Peti göster** seçeneğini kullanın.

### Kaynak koddan geliştirme

#### Gereksinimler

- Node.js 20 veya üzeri
- Rust ve Cargo
- Windows'ta: WebView2 Runtime ve Microsoft C++ Build Tools — **Desktop development with C++** bileşeni
- macOS'ta: macOS 10.15 veya üzeri ve Xcode Command Line Tools (`xcode-select --install`)

#### Kurulum ve çalıştırma

```powershell
npm install
npm run dev
```

`npm run dev`, Vite geliştirme sunucusunu `127.0.0.1:1420` adresinde ve Tauri masaüstü kabuğunu birlikte çalıştırır. Terminal kapatıldığında geliştirme sürümü de kapanır.

Yalnızca tarayıcı arayüzünü çalıştırmak için:

```powershell
npm run dev:web
```

Tarayıcı önizlemesi peti tarayıcı alanında tutar. Tauri sürümü ise şeffaf pet penceresini gerçek Windows veya macOS masaüstü çalışma alanında hareket ettirir.

#### Test ve paketleme

```powershell
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

`npm run build`, güncel Windows MSI ve NSIS kurulum paketlerini `src-tauri/target/release/bundle/` altında üretir.

Universal macOS paketleri yalnız macOS üzerinde üretilebilir. Fiziksel Mac gerektirmeyen önerilen yöntem repodaki GitHub Actions iş akışıdır. Bir Mac üzerinde yerel üretim için:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin
APPLE_SIGNING_IDENTITY="-" npm run build:macos
```

Çıktılar `src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/` altında oluşur. macOS uygulaması gerçek imleç konumunu Tauri üzerinden, kullanıcı boşta kalma süresini CoreGraphics üzerinden okur. Mac'e özgü bu kod hedef koşullarıyla ayrılmıştır ve Windows derlemesine dahil edilmez.

### Teknoloji ve mimari

- **Tauri 2 + Rust:** Masaüstü pencereleri, sistem tepsisi, yerel zamanlayıcı, bildirimler ve kalıcı veri deposu
- **TypeScript + Vite:** Pet arayüzü, kontrol merkezi ve uygulama davranışları
- **Durum makinesi:** İhtiyaçlara, kullanıcı etkileşimlerine ve zamana göre doğal pet davranışları
- **Sprite renderer:** 8×11 animasyon atlasları, bakış yönleri ve pete özel durum görselleri
- **Fizik sistemi:** Sürükleme, fırlatma, yerçekimi, kenar çarpışmaları ve yumuşak hareket
- **Yerel organizatör:** Not, hatırlatıcı ve alarm verileri için cihaz üzerinde saklama

### Gizlilik

- Ekran içeriği okunmaz veya kaydedilmez.
- Bulut hesabı ve uzaktaki bir sunucu zorunlu değildir.
- Kullanıcı verileri yerel cihazda tutulur.
- Pet yalnızca imleç konumu, kullanıcı boşta kalma süresi ve yerel saat gibi davranış için gereken masaüstü sinyallerini kullanır.

---

## English

### About the project

Desktop Pet is an interactive virtual companion that lives on top of your Windows or macOS desktop. It roams across the usable screen area, follows the cursor, rests naturally, and responds to user interactions with character-specific animations and sounds.

No cloud account is required. Pet settings, position, notes, reminders, alarms and interaction memory are stored locally on the user's computer.

### Pets

- **Tiny Robot:** A small robot with cute synthetic chatter and reaction sounds.
- **Tiny Astronaut:** A tiny astronaut with its own lower-pitched android voice.
- **Pixel Cat:** A pixel cat with natural cat sounds, purring, grooming and a dedicated curled sleeping pose.

### Highlights

- Transparent, borderless and always-on-top desktop window
- Pinned, hybrid and full-desktop roaming modes
- Z-depth, perspective tilt, dynamic scale and contact shadows for three-dimensional free roaming
- Grounded walking, natural leaps, climbing and perching for the cat; hover/thruster travel for the robot and astronaut
- Natural acceleration, deceleration, walking cadence, running and idle pauses
- Drag, shake and throw interactions
- Edge collisions, bouncing, inertia and dizzy reactions
- Dance, sleep and focus commands
- Needs that evolve over time, including energy, joy, comfort and patience
- Tired, angry, happy, curious, observing and startled states
- Autonomous behaviors such as cat grooming and spontaneous resting
- Droid-style voices for the robot and astronaut; natural reactions for the cat
- Hide the pet and restore it from the Windows system tray or macOS menu bar
- Editable notes, one-time reminders and one-time/daily alarms
- Complete or snooze due reminders
- Separate audio channels with per-channel volume controls
- Optional launch at Windows or macOS startup
- Configurable pet name, character, size, activity level and movement mode
- Speech bubbles that follow the moving pet
- Local persistence for settings, organizer data and pet position

### Installing for end users

End users do not need Node.js or Rust. Current Windows x64 installers are available directly in the repository:

- [Desktop Pet v0.3.0 — Windows Setup EXE](releases/v0.3.0/Desktop-Pet-0.3.0-Windows-x64-Setup.exe)
- [Desktop Pet v0.3.0 — Windows MSI](releases/v0.3.0/Desktop-Pet-0.3.0-Windows-x64.msi)
- [SHA-256 checksums](releases/v0.3.0/SHA256SUMS.txt)

The NSIS `setup.exe` is the simplest choice for most users. The MSI package is better suited to managed or enterprise deployment.

These files were built from the v0.3.0 source. Sleep and wake actions do not display text bubbles, the brief `zZ` indicator disappears after 3.5 seconds, and the Windows system tray icon is included.

> [!NOTE]
> Windows SmartScreen may show an “Unknown publisher” warning when the installer has not been signed with a code-signing certificate.

#### macOS

The project builds Universal `.app` and `.dmg` packages that support Apple Silicon and Intel Macs. On every relevant push to `main`, and on manual runs, the **macOS Universal Build** GitHub Actions workflow runs the checks on a real macOS runner and creates:

- `Connected-Desktop-Pets-macOS-universal.dmg`
- `Connected-Desktop-Pets-macOS-universal.app.zip`
- `SHA256SUMS.txt`
- `BINARY-ARCHITECTURES.txt`

Download them from **Actions → macOS Universal Build → latest successful run → Artifacts**. CI uses ad-hoc signing so the Apple Silicon app is structurally signed, but this is not Apple notarization. macOS may require approval under **Privacy & Security** the first time an Internet-downloaded test build is opened. Public end-user distribution should use a `Developer ID Application` certificate and Apple notarization.

### Usage

- Press and drag the pet to move it.
- Build up speed while dragging and release to throw it.
- Right-click the pet to open the quick menu.
- Use the quick menu for dance, sleep, focus, pin and hide commands.
- Open the **Control Center** for notes, reminders, alarms and pet settings.
- To restore a hidden pet, use its Windows system tray or macOS menu bar icon and select **Show pet**.

### Development from source

#### Requirements

- Node.js 20 or newer
- Rust and Cargo
- On Windows: WebView2 Runtime and Microsoft C++ Build Tools with **Desktop development with C++**
- On macOS: macOS 10.15 or newer and Xcode Command Line Tools (`xcode-select --install`)

#### Install and run

```powershell
npm install
npm run dev
```

`npm run dev` starts both the Vite development server at `127.0.0.1:1420` and the Tauri desktop shell. Closing the terminal stops the development build.

For a browser-only UI preview:

```powershell
npm run dev:web
```

The browser preview keeps the pet inside the viewport. The native Tauri build moves the transparent pet window across the actual Windows or macOS desktop work area.

#### Test and package

```powershell
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

`npm run build` creates up-to-date Windows MSI and NSIS installers under `src-tauri/target/release/bundle/`.

Universal macOS packages must be produced on macOS. The repository's GitHub Actions workflow is the recommended option when no physical Mac is available. For a local build on a Mac:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin
APPLE_SIGNING_IDENTITY="-" npm run build:macos
```

The outputs are written under `src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/`. On macOS the app reads the real cursor position through Tauri and the user idle duration through CoreGraphics. This platform-specific implementation is compile-time isolated and does not enter the Windows build.

### Technology and architecture

- **Tauri 2 + Rust:** Desktop windows, system tray, native scheduler, notifications and persistent storage
- **TypeScript + Vite:** Pet UI, Control Center and application behavior
- **State machine:** Natural pet behavior driven by needs, interactions and time
- **Sprite renderer:** 8×11 animation atlases, look directions and pet-specific state artwork
- **Physics system:** Dragging, throwing, gravity, edge collisions and soft movement
- **Local organizer:** On-device notes, reminders and alarm data

### Privacy

- The app does not read or record screen contents.
- No cloud account or remote server is required.
- User data remains on the local device.
- The pet only uses desktop signals needed for behavior, such as cursor position, user idle time and local time.

---

Version: **0.3.0** · Platforms: **Windows x64 · macOS Universal (Apple Silicon + Intel)**
