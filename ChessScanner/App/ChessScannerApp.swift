import SwiftUI

@main
struct ChessScannerApp: App {
    @State private var splashFinished = UITestHooks.isUITest

    init() {
        // Stockfish shares this process's stdout; never let a broken pipe kill the app.
        signal(SIGPIPE, SIG_IGN)
        if UITestHooks.isUITest {
            UITestHooks.prepareForUITest()
        }
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                NavigationStack {
                    CameraLandingView()
                }
                .tint(Theme.accent)

                if !splashFinished {
                    SplashView(isFinished: $splashFinished)
                        .zIndex(1)
                }
            }
            .preferredColorScheme(.dark)
            // Start Stockfish and load its networks while the user frames the board.
            .task { await ChessEngine.shared.initialize() }
        }
    }
}

/// Launch-environment hooks used by the UI test target. Inert in normal runs.
enum UITestHooks {
    static var isUITest: Bool {
        ProcessInfo.processInfo.environment["UITEST"] == "1"
    }

    /// Absolute path of an image to scan on launch, bypassing the camera.
    static var scanImagePath: String? {
        guard isUITest else { return nil }
        return ProcessInfo.processInfo.environment["UITEST_SCAN_IMAGE"]
    }

    /// Position to open the editor on at launch, used for App Store screenshots.
    static var editorFEN: String? {
        guard isUITest else { return nil }
        return ProcessInfo.processInfo.environment["UITEST_EDITOR_FEN"]
    }

    @MainActor static func prepareForUITest() {
        if ProcessInfo.processInfo.environment["UITEST_RESET"] == "1" {
            UserDefaults.standard.removeObject(forKey: "chess_scan_history")
        }
        UIView.setAnimationsEnabled(ProcessInfo.processInfo.environment["UITEST_ANIMATIONS"] == "1")
    }
}
