import SwiftUI

@main
struct ChessScannerApp: App {
    @State private var splashFinished = UITestHooks.isUITest

    init() {
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

                if !splashFinished {
                    SplashView(isFinished: $splashFinished)
                        .zIndex(1)
                }
            }
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

    @MainActor static func prepareForUITest() {
        if ProcessInfo.processInfo.environment["UITEST_RESET"] == "1" {
            UserDefaults.standard.removeObject(forKey: "chess_scan_history")
        }
        UIView.setAnimationsEnabled(ProcessInfo.processInfo.environment["UITEST_ANIMATIONS"] == "1")
    }
}
