import AppKit
import WebKit
import UserNotifications

struct LauncherConfig: Decodable { let node: String; let cli: String; let log: String; let controlRoomURL: String }

final class LauncherApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSTextField!
    var statusItem: NSStatusItem!
    var connectionItem: NSMenuItem!
    var worker: Process?
    var pending = Data()
    var welcome: NSStackView!
    var setupButton: NSButton!
    var config: LauncherConfig?
    var endpoint: URL?
    var receivedResult = false
    var loaded = false
    var pollTimer: Timer?
    var priorStates: [String: String] = [:]
    var notificationItem: NSMenuItem!
    var notificationsEnabled = UserDefaults.standard.bool(forKey: "taskNotifications")
    let login = CommandLine.arguments.contains("--login")

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Stream Deck Micro — Control Center"
        window.minSize = NSSize(width: 860, height: 620)
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("MicroControlCenter")
        window.center()
        let root = NSView()
        window.contentView = root
        status = NSTextField(labelWithString: "Starting the local service…")
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        let refresh = NSButton(title: "Reload", target: self, action: #selector(reloadDashboard))
        let browser = NSButton(title: "Open in Browser", target: self, action: #selector(openBrowser))
        setupButton = NSButton(title: "Set Up Local Bridge", target: self, action: #selector(setupBridge))
        setupButton.isHidden = true
        let plugin = NSButton(title: "Install Elgato Plugin", target: self, action: #selector(installPlugin))
        plugin.isHidden = !FileManager.default.fileExists(atPath: Bundle.main.resourcePath! + "/Micro.streamDeckPlugin")
        let top = NSStackView(views: [status, setupButton, plugin, refresh, browser])
        top.spacing = 14
        top.edgeInsets = NSEdgeInsets(top: 9, left: 16, bottom: 9, right: 12)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "microClipboard")
        configuration.userContentController.addUserScript(WKUserScript(source: """
        Object.defineProperty(navigator, 'clipboard', {value: {
          writeText: text => window.webkit.messageHandlers.microClipboard.postMessage(String(text))
        }, configurable: true});
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Use the same finishing stylesheet as the browser, including with an
        // already-running daemon. Reuse its nonce rather than weakening its CSP.
        if let cssURL = Bundle.main.url(forResource: "ControlCenter", withExtension: "css"),
           let css = try? String(contentsOf: cssURL, encoding: .utf8),
           let data = try? JSONSerialization.data(withJSONObject: [css]),
           let literal = String(data: data, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: """
            const nativeStyle = document.createElement('style');
            nativeStyle.nonce = document.querySelector('style[nonce]')?.nonce || '';
            nativeStyle.textContent = \(literal)[0];
            document.head.appendChild(nativeStyle);
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        top.translatesAutoresizingMaskIntoConstraints = false
        web.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(top); root.addSubview(web)
        let welcomeTitle = NSTextField(labelWithString: "Your deck. Your Mac.")
        welcomeTitle.font = .systemFont(ofSize: 30, weight: .semibold)
        let welcomeCopy = NSTextField(wrappingLabelWithString: "Move this app to Applications. Install ChatGPT and sign in, then install Elgato Stream Deck 7.1 or newer.\n\nUse Install Elgato Plugin above to add the included plugin and profile. Set Up Local Bridge prepares the connection and starts your local service. Existing Codex sessions are never restarted.")
        welcomeCopy.font = .systemFont(ofSize: 16); welcomeCopy.textColor = .secondaryLabelColor
        let welcomeSetup = NSButton(title: "Set Up Local Bridge", target: self, action: #selector(setupBridge))
        welcome = NSStackView(views: [welcomeTitle, welcomeCopy, welcomeSetup])
        welcome.orientation = .vertical; welcome.alignment = .leading; welcome.spacing = 22
        welcome.translatesAutoresizingMaskIntoConstraints = false; welcome.isHidden = true
        root.addSubview(welcome)
        NSLayoutConstraint.activate([welcome.centerXAnchor.constraint(equalTo: root.centerXAnchor), welcome.centerYAnchor.constraint(equalTo: root.centerYAnchor), welcome.widthAnchor.constraint(equalToConstant: 510)])
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: root.topAnchor), top.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            top.trailingAnchor.constraint(equalTo: root.trailingAnchor), top.heightAnchor.constraint(equalToConstant: 48),
            web.topAnchor.constraint(equalTo: top.bottomAnchor), web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor), web.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        if !login { showDashboard() }
        UNUserNotificationCenter.current().delegate = self
        do {
            guard let url = Bundle.main.url(forResource: "launcher", withExtension: "json") else {
                throw NSError(domain: "Micro", code: 1, userInfo: [NSLocalizedDescriptionKey: "Launcher configuration is missing."])
            }
            let settings = try JSONDecoder().decode(LauncherConfig.self, from: Data(contentsOf: url))
            guard let url = URL(string: settings.controlRoomURL), ControlCenterPolicy.validEndpoint(url) else {
                throw NSError(domain: "Micro", code: 2, userInfo: [NSLocalizedDescriptionKey: "The Control Center must use the local Micro service."])
            }
            let resources = Bundle.main.resourceURL!
            let node = settings.node.hasPrefix("/") ? settings.node : resources.appendingPathComponent(settings.node).path
            let cli = settings.cli.hasPrefix("/") ? settings.cli : resources.appendingPathComponent(settings.cli).path
            let log = (settings.log as NSString).expandingTildeInPath
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: log).deletingLastPathComponent(), withIntermediateDirectories: true)
            let resolved = LauncherConfig(node: node, cli: cli, log: log, controlRoomURL: settings.controlRoomURL)
            config = resolved; endpoint = url
            startWorker(resolved)
        } catch { finish("error", error.localizedDescription) }
    }
    func buildMenus() {
        let menu = NSMenu()
        func section(_ name: String, _ items: [NSMenuItem]) {
            let parent = NSMenuItem(title: name, action: nil, keyEquivalent: "")
            let child = NSMenu(title: name); items.forEach { child.addItem($0) }
            parent.submenu = child; menu.addItem(parent)
        }
        notificationItem = item(notificationsEnabled ? "Disable Task Notifications" : "Enable Task Notifications…", #selector(enableNotifications), "")
        section("Codex + Stream Deck", [item("Show Control Center", #selector(showDashboard), "0"),
            notificationItem, .separator(),
            item("Quit Control Center", #selector(quitApp), "q")])
        section("Edit", [NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"),
            NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"),
            NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"),
            NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"),
            NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")])
        section("View", [item("Reload Control Center", #selector(reloadDashboard), "r"), item("Open in Browser", #selector(openBrowser), "")])
        section("Window", [item("Show Control Center", #selector(showDashboard), ""), NSMenuItem(title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")])
        NSApp.mainMenu = menu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "square.grid.3x3.fill", accessibilityDescription: "Stream Deck Micro")
        statusItem.button?.toolTip = "Stream Deck Micro"
        let tray = NSMenu()
        connectionItem = NSMenuItem(title: "Starting…", action: nil, keyEquivalent: "")
        tray.addItem(connectionItem); tray.addItem(.separator())
        tray.addItem(item("Show Control Center", #selector(showDashboard), ""))
        tray.addItem(item("Reload", #selector(reloadDashboard), ""))
        tray.addItem(item("Open in Browser", #selector(openBrowser), ""))
        tray.addItem(.separator()); tray.addItem(item("Quit Control Center", #selector(quitApp), ""))
        statusItem.menu = tray
    }
    func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key); result.target = self; return result
    }
    @objc func showDashboard() { window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func setupBridge() { if let settings = config { startWorker(settings, setup: true) } }
    @objc func installPlugin() {
        if let resource = Bundle.main.resourceURL?.appendingPathComponent("Micro.streamDeckPlugin"), FileManager.default.fileExists(atPath: resource.path) { NSWorkspace.shared.open(resource) }
    }
    @objc func quitApp() { NSApp.terminate(nil) }
    @objc func openBrowser() { if let url = endpoint { NSWorkspace.shared.open(url) } }
    @objc func reloadDashboard() {
        guard let url = endpoint else { return }
        loaded = false
        setStatus("Loading Control Center…")
        web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    }
    func setStatus(_ text: String) { status.stringValue = text; connectionItem.title = text; statusItem.button?.toolTip = text }
    func startWorker(_ settings: LauncherConfig, setup: Bool = false) {
        guard worker?.isRunning != true else { return }
        receivedResult = false; setupButton.isEnabled = false
        let process = Process(); process.executableURL = URL(fileURLWithPath: settings.node)
        process.arguments = [settings.cli] + (setup ? ["--setup"] : CommandLine.arguments.contains("--control-center") ? ["--control-center"] : [])
        process.environment = ProcessInfo.processInfo.environment.merging(["SDM_NATIVE_BUNDLE": Bundle.main.bundlePath]) { _, new in new }
        let pipe = Pipe(); process.standardOutput = pipe
        do {
            if !FileManager.default.fileExists(atPath: settings.log) { FileManager.default.createFile(atPath: settings.log, contents: nil) }
            let errors = try FileHandle(forWritingAtPath: settings.log).unwrap()
            try errors.seekToEnd(); process.standardError = errors
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; return }
                DispatchQueue.main.async { self?.consume(data) }
            }
            process.terminationHandler = { [weak self] _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    guard let self = self, !self.receivedResult else { return }
                    self.finish("error", "Startup stopped. Open the dashboard or check launcher.error.log.")
                }
            }
            worker = process; try process.run()
        } catch { finish("error", error.localizedDescription) }
    }
    func consume(_ data: Data) {
        pending.append(data)
        while let end = pending.firstIndex(of: 10) {
            let line = pending.prefix(upTo: end); pending.removeSubrange(...end)
            guard let record = (try? JSONSerialization.jsonObject(with: line)) as? [String: String],
                  let state = record["state"], let message = record["message"] else { continue }
            if state == "progress" { setStatus(message) } else { finish(state, message) }
        }
    }
    func finish(_ state: String, _ message: String) {
        receivedResult = true; setStatus(message); setupButton.isEnabled = true
        if state == "setup-required" {
            setupButton.isHidden = false
            web.isHidden = true; welcome.isHidden = false
            showDashboard()
            return
        }
        if state == "error" { setupButton.isHidden = false } else { setupButton.isHidden = true }
        web.isHidden = false; welcome.isHidden = true
        // Recovery and configuration must remain available even when Codex is private.
        reloadDashboard()
        if !login || state == "error" { showDashboard() }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showDashboard(); return true }
    func applicationWillTerminate(_ notification: Notification) { pollTimer?.invalidate() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let endpoint = endpoint else { decisionHandler(.cancel); return }
        if ControlCenterPolicy.sameOrigin(url, endpoint) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, let endpoint = endpoint {
            if ControlCenterPolicy.sameOrigin(url, endpoint) { web.load(URLRequest(url: url)) }
            else if action.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true; pollStatus()
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.pollStatus() }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showLoadFailure(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showLoadFailure(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loaded = false; setStatus("Dashboard paused. Choose Reload to reconnect.") }
    func showLoadFailure(_ error: Error) {
        loaded = false; setStatus("Local service unavailable. Choose Reload to try again. \(error.localizedDescription)")
        if login { showDashboard() }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let endpoint = endpoint,
              message.frameInfo.securityOrigin.protocol == endpoint.scheme,
              message.frameInfo.securityOrigin.host == endpoint.host,
              message.frameInfo.securityOrigin.port == endpoint.port,
              let text = message.body as? String, text.utf8.count <= 1_000_000 else {
            replyHandler(nil, "Clipboard request rejected"); return
        }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
        replyHandler(nil, nil)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "Continue"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt; alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 340, height: 24)); input.stringValue = defaultText ?? ""
        alert.accessoryView = input; alert.window.initialFirstResponder = input
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? input.stringValue : nil) }
    }
    func pollStatus() {
        guard loaded else { return }
        web.callAsyncJavaScript("""
        const token = document.querySelector('meta[name="sdm-api-token"]')?.content;
        const response = await fetch('/api/status', {headers: {'x-stream-deck-micro-token': token || ''}});
        if (!response.ok) throw new Error('Local service needs a reload');
        const data = await response.json();
        return {desktop: data.desktop, slots: (data.slots || []).map(s => ({index:s.index,state:s.state,label:s.label,sessionId:s.sessionId}))};
        """, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let value):
                guard let data = value as? [String: Any], let desktop = data["desktop"] as? [String: Any] else { return }
                let connected = desktop["state"] as? String == "connected" && desktop["sessionsReady"] as? Bool == true
                self.setStatus(connected ? "Connected · Codex and Stream Deck" : "Control Center ready · Live Codex control unavailable")
                for slot in data["slots"] as? [[String: Any]] ?? [] {
                    guard let sessionID = slot["sessionId"] as? String, let state = slot["state"] as? String else { continue }
                    let previous = self.priorStates[sessionID]
                    if self.notificationsEnabled && ["running", "thinking"].contains(previous ?? "") && ["idle", "done", "error"].contains(state) {
                        let content = UNMutableNotificationContent()
                        content.title = slot["label"] as? String ?? "Codex task"
                        content.body = state == "error" ? "Task needs attention." : "Task status changed to \(state)."
                        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
                    }
                    self.priorStates[sessionID] = state
                }
            case .failure: self.setStatus("Connection interrupted. Choose Reload to reconnect to the local service.")
            }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.showDashboard(); completionHandler() }
    }
    @objc func enableNotifications() {
        if notificationsEnabled {
            notificationsEnabled = false
            UserDefaults.standard.set(false, forKey: "taskNotifications")
            notificationItem.title = "Enable Task Notifications…"
            return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            DispatchQueue.main.async { self?.notificationsEnabled = granted; UserDefaults.standard.set(granted, forKey: "taskNotifications"); self?.notificationItem.title = granted ? "Disable Task Notifications" : "Enable Task Notifications…" }
        }
    }
}
extension Optional {
    func unwrap() throws -> Wrapped {
        guard let value = self else { throw NSError(domain: "Micro", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not open the launcher log."]) }
        return value
    }
}
@main
struct ControlCenterMain {
    static func main() {
        let delegate = LauncherApp()
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.delegate = delegate
        withExtendedLifetime(delegate) { NSApplication.shared.run() }
    }
}
