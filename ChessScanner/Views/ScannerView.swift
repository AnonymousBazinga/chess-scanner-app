import SwiftUI
@preconcurrency import AVFoundation

// MARK: - Camera Model

@MainActor
class CameraModel: NSObject, ObservableObject, @unchecked Sendable {
    @Published var isFlashOn = false
    /// True once the preview is live; false in the simulator or without permission.
    @Published var isRunning = false
    @Published var session = AVCaptureSession()

    private var output = AVCapturePhotoOutput()
    private var completionHandler: ((UIImage) -> Void)?

    func checkPermissions() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupCamera()
        case .notDetermined:
            // Called on an arbitrary queue: must not inherit main-actor isolation.
            AVCaptureDevice.requestAccess(for: .video) { @Sendable [weak self] granted in
                if granted {
                    Task { @MainActor [weak self] in
                        self?.setupCamera()
                    }
                }
            }
        default:
            break
        }
    }

    private func setupCamera() {
        session.beginConfiguration()
        session.sessionPreset = .photo

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device) else {
            session.commitConfiguration()
            return
        }

        if session.canAddInput(input) {
            session.addInput(input)
        }
        if session.canAddOutput(output) {
            session.addOutput(output)
        }

        session.commitConfiguration()

        let captureSession = session
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            captureSession.startRunning()
            let running = captureSession.isRunning
            Task { @MainActor [weak self] in self?.isRunning = running }
        }
    }

    func capturePhoto(completion: @escaping (UIImage) -> Void) {
        completionHandler = completion
        let settings = AVCapturePhotoSettings()
        if isFlashOn {
            settings.flashMode = .on
        }
        output.capturePhoto(with: settings, delegate: self)
    }

    func toggleFlash() {
        isFlashOn.toggle()
    }
}

extension CameraModel: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput,
                                 didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data) else { return }
        Task { @MainActor [weak self] in
            self?.completionHandler?(image)
            self?.completionHandler = nil
        }
    }
}

// MARK: - Camera Preview

struct CameraPreview: UIViewRepresentable {
    @ObservedObject var camera: CameraModel

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: UIScreen.main.bounds)
        let previewLayer = AVCaptureVideoPreviewLayer(session: camera.session)
        previewLayer.frame = view.frame
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
