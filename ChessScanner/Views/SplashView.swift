import SwiftUI

struct SplashView: View {
    @Binding var isFinished: Bool

    @State private var kingOpacity: Double = 0
    @State private var kingScale: CGFloat = 0.8
    @State private var doorOpen: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let halfWidth = geo.size.width / 2

            ZStack {
                // Left half — white
                Rectangle()
                    .fill(Color.white)
                    .frame(width: halfWidth)
                    .offset(x: -halfWidth / 2 - doorOpen)

                // Right half — dark
                Rectangle()
                    .fill(Color(white: 0.08))
                    .frame(width: halfWidth)
                    .offset(x: halfWidth / 2 + doorOpen)

                // King icon at the seam
                Text("\u{265A}")
                    .font(.system(size: 56, weight: .thin))
                    .foregroundStyle(NotionTheme.accent)
                    .opacity(kingOpacity)
                    .scaleEffect(kingScale)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea()
        .onAppear {
            // Phase 1: King fades in with scale
            withAnimation(.easeOut(duration: 0.4)) {
                kingOpacity = 1
                kingScale = 1.0
            }

            // Phase 2: Hold, then doors slide open
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                withAnimation(.easeInOut(duration: 0.7)) {
                    doorOpen = UIScreen.main.bounds.width
                    kingOpacity = 0
                }

                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    isFinished = true
                }
            }
        }
    }
}
