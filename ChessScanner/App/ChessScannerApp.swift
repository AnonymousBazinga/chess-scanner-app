import SwiftUI

@main
struct ChessScannerApp: App {
    @State private var splashFinished = false

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
