import SwiftUI

struct SplashView: View {
    @Binding var isFinished: Bool

    @State private var appear = false
    @State private var leave = false

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 18) {
                Image("piece-wN")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 84, height: 84)
                    .padding(22)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(Theme.accent.opacity(appear ? 0.8 : 0), lineWidth: 2))
                    .scaleEffect(appear ? 1 : 0.8)
                Text("Chess Scanner")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                    .opacity(appear ? 1 : 0)
                    .offset(y: appear ? 0 : 8)
            }
            .scaleEffect(leave ? 1.08 : 1)
        }
        .opacity(leave ? 0 : 1)
        .task {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.75)) { appear = true }
            try? await Task.sleep(for: .milliseconds(900))
            withAnimation(.easeIn(duration: 0.3)) { leave = true }
            try? await Task.sleep(for: .milliseconds(300))
            isFinished = true
        }
    }
}
