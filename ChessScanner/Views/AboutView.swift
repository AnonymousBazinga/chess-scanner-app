import SwiftUI

/// Credits and the license notices the bundled components require.
struct AboutView: View {
    private struct Credit: Identifiable {
        let name: String
        let detail: String
        let license: String
        let url: String
        var id: String { name }
    }

    private let credits: [Credit] = [
        Credit(name: "Stockfish 17",
               detail: "Chess engine by the Stockfish developers.",
               license: "GNU General Public License v3",
               url: "https://stockfishchess.org"),
        Credit(name: "ChessQ Lite",
               detail: "Board recognition model. Copyright (c) 2026 Joël Seytre.",
               license: "PolyForm Noncommercial 1.0.0",
               url: "https://chessq.org"),
        Credit(name: "DINOv2",
               detail: "Image encoder in ChessQ Lite. Copyright (c) Meta Platforms, Inc. and affiliates.",
               license: "Apache License 2.0",
               url: "https://github.com/facebookresearch/dinov2"),
        Credit(name: "Chess pieces",
               detail: "cburnett piece set by Colin M.L. Burnett.",
               license: "CC BY-SA 3.0",
               url: "https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces"),
        Credit(name: "ChessKitEngine",
               detail: "Stockfish integration for Swift.",
               license: "MIT License",
               url: "https://github.com/chesskit-app/chesskit-engine"),
        Credit(name: "ONNX Runtime",
               detail: "On-device model inference by Microsoft.",
               license: "MIT License",
               url: "https://onnxruntime.ai"),
    ]

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "Version \(short) (\(build))"
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Chess Scanner")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(version)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    Text("Photos are processed on your device and never uploaded.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.top, 4)
                }
                .padding(.vertical, 6)
            }
            .listRowBackground(Theme.surface)

            Section("Acknowledgements") {
                ForEach(credits) { credit in
                    Link(destination: URL(string: credit.url)!) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(credit.name)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.textPrimary)
                            Text(credit.detail)
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                            Text(credit.license)
                                .font(.caption)
                                .foregroundStyle(Theme.textTertiary)
                        }
                        .padding(.vertical, 3)
                    }
                }
            }
            .listRowBackground(Theme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }
}

#Preview {
    NavigationStack { AboutView() }
        .preferredColorScheme(.dark)
}
