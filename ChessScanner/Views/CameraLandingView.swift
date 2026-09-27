import SwiftUI

struct CameraLandingView: View {
    @StateObject private var camera = CameraModel()
    @StateObject private var recognitionService = BoardRecognitionService()
    @StateObject private var historyStore = ScanHistoryStore()

    @State private var showHistory = false
    @State private var showPhotoLibrary = false
    @State private var capturedImage: UIImage?
    @State private var isProcessing = false
    @State private var detectedFEN: String?
    @State private var navigateToEditor = false
    @State private var navigateToAnalysis = false
    @State private var analysisStartFEN = Position.startFEN
    @State private var shutterScale: CGFloat = 1.0
    @State private var toastMessage: String?
    @State private var showToast = false
    @State private var pendingHistoryFEN: String?
    @State private var didRunUITestScan = false

    var body: some View {
        ZStack {
            // Camera preview
            CameraPreview(camera: camera)
                .ignoresSafeArea()

            // Controls overlay
            VStack(spacing: 0) {
                topBar
                Spacer()
                boardGuide
                    .padding(.horizontal, 40)
                Spacer()
                captureSection
            }

            // Processing overlay
            if isProcessing {
                processingOverlay
            }

            // Toast banner
            if showToast, let message = toastMessage {
                VStack {
                    toastBanner(message)
                        .padding(.horizontal, 20)
                        .padding(.top, 60)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .onAppear {
            if let path = UITestHooks.scanImagePath {
                // UI tests inject a board photo instead of using the camera.
                if !didRunUITestScan, let image = UIImage(contentsOfFile: path) {
                    didRunUITestScan = true
                    processImage(image, cropToGuide: false)
                }
            } else if !UITestHooks.isUITest {
                camera.checkPermissions()
            }
        }
        .onChange(of: recognitionService.isProcessing) { _, processing in
            guard !processing, isProcessing else { return }
            isProcessing = false
            if let fen = recognitionService.detectedFEN {
                detectedFEN = fen
                navigateToEditor = true
            } else {
                showToastMessage(recognitionService.error ?? "Could not detect board")
            }
        }
        .sheet(isPresented: $showPhotoLibrary) {
            PhotoPicker(image: $capturedImage)
        }
        .sheet(isPresented: $showHistory) {
            NavigationStack {
                HistoryView(store: historyStore) { fen in
                    pendingHistoryFEN = fen
                }
            }
        }
        .navigationDestination(isPresented: $navigateToEditor) {
            BoardEditView(initialFEN: detectedFEN ?? Position.startFEN) { fen in
                historyStore.addItem(fen: fen)
                analysisStartFEN = fen
                navigateToAnalysis = true
            }
        }
        .navigationDestination(isPresented: $navigateToAnalysis) {
            AnalysisView(fen: analysisStartFEN)
        }
        .onChange(of: capturedImage) { _, image in
            if let image {
                capturedImage = nil
                processImage(image, cropToGuide: false)
            }
        }
        .onChange(of: showHistory) { _, isShowing in
            if !isShowing, let fen = pendingHistoryFEN {
                pendingHistoryFEN = nil
                analysisStartFEN = fen
                navigateToAnalysis = true
            }
        }
        .statusBarHidden()
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack {
            Button {
                showHistory = true
            } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .accessibilityLabel("History")
            .accessibilityIdentifier("scan.history")

            Spacer()

            Button {
                camera.toggleFlash()
            } label: {
                Image(systemName: camera.isFlashOn ? "bolt.fill" : "bolt.slash.fill")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(camera.isFlashOn ? NotionTheme.accent : .white)
                    .frame(width: 42, height: 42)
                    .background(.ultraThinMaterial, in: Circle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
    }

    // MARK: - Board Guide

    private var boardGuide: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(.white.opacity(0.5), lineWidth: 2)
                .frame(width: size, height: size)
                .overlay {
                    Canvas { context, canvasSize in
                        let step = canvasSize.width / 8
                        for i in 1..<8 {
                            let x = step * CGFloat(i)
                            let y = step * CGFloat(i)
                            context.stroke(
                                Path { p in
                                    p.move(to: CGPoint(x: x, y: 0))
                                    p.addLine(to: CGPoint(x: x, y: canvasSize.height))
                                },
                                with: .color(.white.opacity(0.15)),
                                lineWidth: 0.5
                            )
                            context.stroke(
                                Path { p in
                                    p.move(to: CGPoint(x: 0, y: y))
                                    p.addLine(to: CGPoint(x: canvasSize.width, y: y))
                                },
                                with: .color(.white.opacity(0.15)),
                                lineWidth: 0.5
                            )
                        }
                    }
                }
                .shadow(color: NotionTheme.accent.opacity(0.12), radius: 12, x: 0, y: 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
    }

    // MARK: - Capture Section

    private var captureSection: some View {
        VStack(spacing: 18) {
            // Shutter button
            Button {
                withAnimation(.easeOut(duration: 0.1)) {
                    shutterScale = 0.88
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    withAnimation(.easeOut(duration: 0.15)) {
                        shutterScale = 1.0
                    }
                }
                camera.capturePhoto { image in
                    processImage(image, cropToGuide: true)
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(.white)
                        .frame(width: 70, height: 70)
                    Circle()
                        .strokeBorder(.white, lineWidth: 4)
                        .frame(width: 80, height: 80)
                    Circle()
                        .strokeBorder(NotionTheme.accent.opacity(0.5), lineWidth: 2)
                        .frame(width: 88, height: 88)
                }
                .scaleEffect(shutterScale)
            }
            .accessibilityLabel("Scan board")
            .accessibilityIdentifier("scan.shutter")

            // Gallery button
            Button {
                showPhotoLibrary = true
            } label: {
                Text("Use gallery instead")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.75))
            }
            .accessibilityIdentifier("scan.gallery")
            .padding(.bottom, 24)
        }
    }

    // MARK: - Processing Overlay

    private var processingOverlay: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.2)
                Text("Scanning board...")
                    .font(.headline)
                    .foregroundStyle(.white)
            }
            .padding(32)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .accessibilityIdentifier("scan.processing")
        }
    }

    // MARK: - Toast

    private func toastBanner(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(NotionTheme.warning)
            Text(message)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("scan.toast")
    }

    // MARK: - Image Processing

    private func processImage(_ image: UIImage, cropToGuide: Bool) {
        isProcessing = true
        detectedFEN = nil
        recognitionService.processImage(image, cropToGuide: cropToGuide)
    }

    private func showToastMessage(_ message: String) {
        toastMessage = message
        withAnimation(.easeInOut(duration: 0.3)) {
            showToast = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            withAnimation(.easeInOut(duration: 0.3)) {
                showToast = false
            }
        }
    }
}
