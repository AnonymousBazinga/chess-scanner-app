import SwiftUI

struct CameraLandingView: View {
    @StateObject private var camera = CameraModel()
    @StateObject private var recognitionService = BoardRecognitionService()
    @StateObject private var historyStore = ScanHistoryStore()

    @State private var showHistory = false
    @State private var showPhotoLibrary = false
    @State private var pickedImage: UIImage?
    @State private var scanningImage: UIImage?
    @State private var isProcessing = false
    @State private var detectedFEN: String?
    @State private var editorPhoto: UIImage?
    @State private var navigateToEditor = false
    @State private var navigateToAnalysis = false
    @State private var analysisStartFEN = Position.startFEN
    @State private var toastMessage: String?
    @State private var pendingHistoryFEN: String?
    @State private var didRunUITestScan = false
    @State private var flash = false

    var body: some View {
        ZStack {
            background

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 16)
                viewfinder
                    .padding(.horizontal, 28)
                hint
                    .padding(.top, 18)
                Spacer(minLength: 16)
                controls
            }

            if flash {
                Color.white.ignoresSafeArea().transition(.opacity)
            }

            if let message = toastMessage {
                VStack {
                    Pill(text: message, icon: "exclamationmark.triangle.fill")
                        .background(Theme.surface, in: Capsule())
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("scan.toast")
                        .padding(.top, 70)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(Motion.smooth, value: isProcessing)
        .animation(Motion.snappy, value: toastMessage)
        .onAppear(perform: onAppear)
        .onChange(of: recognitionService.isProcessing) { _, processing in
            guard !processing, isProcessing else { return }
            finishScan()
        }
        .sheet(isPresented: $showPhotoLibrary) {
            PhotoPicker(image: $pickedImage).ignoresSafeArea()
        }
        .sheet(isPresented: $showHistory) {
            NavigationStack {
                HistoryView(store: historyStore) { fen in pendingHistoryFEN = fen }
            }
            .presentationDragIndicator(.visible)
        }
        .navigationDestination(isPresented: $navigateToEditor) {
            BoardEditView(initialFEN: detectedFEN ?? Position.startFEN, photo: editorPhoto) { fen in
                historyStore.addItem(fen: fen)
                analysisStartFEN = fen
                navigateToAnalysis = true
            }
        }
        .navigationDestination(isPresented: $navigateToAnalysis) {
            AnalysisView(fen: analysisStartFEN)
        }
        .onChange(of: pickedImage) { _, image in
            guard let image else { return }
            pickedImage = nil
            processImage(image, cropToGuide: false)
        }
        .onChange(of: showHistory) { _, isShowing in
            if !isShowing, let fen = pendingHistoryFEN {
                pendingHistoryFEN = nil
                analysisStartFEN = fen
                navigateToAnalysis = true
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Background

    @ViewBuilder
    private var background: some View {
        if camera.isRunning {
            CameraPreview(camera: camera)
                .ignoresSafeArea()
                .overlay(Color.black.opacity(0.25).ignoresSafeArea())
        } else {
            Theme.background.ignoresSafeArea()
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            circleButton(icon: "clock.arrow.circlepath", label: "History", id: "scan.history") {
                showHistory = true
            }
            Spacer()
            Text("Chess Scanner")
                .font(.headline)
                .foregroundStyle(.white)
            Spacer()
            circleButton(icon: camera.isFlashOn ? "bolt.fill" : "bolt.slash.fill", label: "Flash", id: "scan.flash",
                         tint: camera.isFlashOn ? Theme.warning : .white) {
                camera.toggleFlash()
            }
            .opacity(camera.isRunning ? 1 : 0.35)
            .disabled(!camera.isRunning)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private func circleButton(icon: String, label: String, id: String, tint: Color = .white,
                              action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }

    // MARK: - Viewfinder

    private var viewfinder: some View {
        ZStack {
            if let image = scanningImage {
                // Fill the square without letting a non-square photo widen the layout.
                Color.clear
                    .overlay {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .transition(.opacity)
            } else if !camera.isRunning {
                VStack(spacing: 12) {
                    Image(systemName: "camera.viewfinder")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(Theme.textSecondary)
                    Text("Camera unavailable")
                        .font(.headline)
                        .foregroundStyle(Theme.textPrimary)
                    Text("Choose a photo of your board instead.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
            }

            ViewfinderBrackets(active: isProcessing)

            if isProcessing {
                ScanLine()
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .accessibilityIdentifier("scan.processing")
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private var hint: some View {
        Text(isProcessing ? "Reading the board…" : "Fit the whole board inside the frame")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white.opacity(0.85))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
            .contentTransition(.opacity)
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(alignment: .center) {
            sideButton(icon: "photo.on.rectangle", title: "Photos", id: "scan.gallery") {
                showPhotoLibrary = true
            }

            Spacer()

            Button(action: capture) {
                ZStack {
                    Circle().strokeBorder(.white, lineWidth: 4).frame(width: 80, height: 80)
                    Circle().fill(camera.isRunning ? Color.white : Color.white.opacity(0.25))
                        .frame(width: 64, height: 64)
                }
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .disabled(!camera.isRunning || isProcessing)
            .accessibilityLabel("Scan board")
            .accessibilityIdentifier("scan.shutter")

            Spacer()

            sideButton(icon: "square.grid.3x3.square", title: "Set up", id: "scan.manual") {
                detectedFEN = Position.startFEN
                editorPhoto = nil
                navigateToEditor = true
            }
        }
        .padding(.horizontal, 36)
        .padding(.bottom, 24)
        .disabled(isProcessing)
    }

    private func sideButton(icon: String, title: String, id: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 52, height: 52)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                Text(title)
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(.white)
        }
        .buttonStyle(PressableStyle())
        .accessibilityIdentifier(id)
    }

    // MARK: - Scanning

    private func onAppear() {
        if let fen = UITestHooks.editorFEN, !didRunUITestScan {
            // Store screenshots open the editor on a chosen position.
            didRunUITestScan = true
            detectedFEN = fen
            editorPhoto = nil
            navigateToEditor = true
        } else if let path = UITestHooks.scanImagePath {
            // UI tests inject a board photo instead of using the camera.
            if !didRunUITestScan, let image = UIImage(contentsOfFile: path) {
                didRunUITestScan = true
                processImage(image, cropToGuide: false)
            }
        } else if !UITestHooks.isUITest {
            camera.checkPermissions()
        }
    }

    private func capture() {
        Haptics.move()
        withAnimation(.easeOut(duration: 0.08)) { flash = true }
        withAnimation(.easeIn(duration: 0.3).delay(0.08)) { flash = false }
        camera.capturePhoto { image in
            processImage(image, cropToGuide: true)
        }
    }

    private func processImage(_ image: UIImage, cropToGuide: Bool) {
        toastMessage = nil
        scanningImage = image
        isProcessing = true
        detectedFEN = nil
        editorPhoto = image
        recognitionService.processImage(image, cropToGuide: cropToGuide)
    }

    private func finishScan() {
        isProcessing = false
        if let result = recognitionService.result {
            Haptics.success()
            detectedFEN = result.fen
            navigateToEditor = true
            // Clear the frozen frame once the editor has covered it.
            Task {
                try? await Task.sleep(for: .milliseconds(600))
                scanningImage = nil
            }
        } else {
            Haptics.warning()
            scanningImage = nil
            showToast(recognitionService.error ?? "Couldn't read the board. Try again.")
        }
    }

    private func showToast(_ message: String) {
        toastMessage = message
        Task {
            try? await Task.sleep(for: .seconds(3))
            if toastMessage == message { toastMessage = nil }
        }
    }
}

// MARK: - Viewfinder pieces

/// Corner brackets marking the scan area; they pulse while scanning.
struct ViewfinderBrackets: View {
    var active: Bool
    @State private var pulse = false

    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width
            let len = s * 0.14
            Path { p in
                let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(0, 0, 1, 1), (s, 0, -1, 1), (0, s, 1, -1), (s, s, -1, -1)]
                for (x, y, dx, dy) in corners {
                    p.move(to: CGPoint(x: x, y: y + dy * len))
                    p.addLine(to: CGPoint(x: x, y: y + dy * 10))
                    p.addQuadCurve(to: CGPoint(x: x + dx * 10, y: y), control: CGPoint(x: x, y: y))
                    p.addLine(to: CGPoint(x: x + dx * len, y: y))
                }
            }
            .stroke(active ? Theme.accent : .white, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            .scaleEffect(active && pulse ? 0.97 : 1)
        }
        .onChange(of: active) { _, isActive in
            withAnimation(isActive ? .easeInOut(duration: 0.7).repeatForever() : .default) { pulse = isActive }
        }
        .allowsHitTesting(false)
    }
}

/// A thin line sweeping over the image while the board is read.
struct ScanLine: View {
    @State private var progress: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            Rectangle()
                .fill(Theme.accent)
                .frame(height: 3)
                .offset(y: progress * (geo.size.height - 3))
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { progress = 1 }
        }
        .allowsHitTesting(false)
    }
}
