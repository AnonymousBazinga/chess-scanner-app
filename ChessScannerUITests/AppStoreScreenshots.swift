import XCTest

/// Captures the App Store screenshots. Runs only when the runner has
/// `STORE_SCREENSHOTS=1` (pass `TEST_RUNNER_STORE_SCREENSHOTS=1` to xcodebuild).
final class AppStoreScreenshots: XCTestCase {
    private var app: XCUIApplication!

    private static let fixturesDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures")

    /// Kasparov–Topalov, Wijk aan Zee 1999, before 24.Rxd4!!
    private static let showcaseFEN = "b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24"

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["STORE_SCREENSHOTS"] == "1",
                          "Store screenshots run only on request")
        continueAfterFailure = false
    }

    func testScanScreen() throws {
        let photo = ProcessInfo.processInfo.environment["STORE_PHOTO"]
            ?? Self.fixturesDir.appendingPathComponent("physical_board.png").path
        launch(["UITEST_SCAN_IMAGE": photo])
        XCTAssertTrue(element("scan.processing").waitForExistence(timeout: 10), "Scan did not start")
        shoot("store-1-scan")
    }

    func testEditorAnalysisAndHistory() throws {
        launch(["UITEST_EDITOR_FEN": Self.showcaseFEN])
        XCTAssertTrue(app.navigationBars["Review Position"].waitForExistence(timeout: 10))
        shoot("store-2-editor")

        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10))
        XCTAssertTrue(waitUntil(timeout: 180) { self.engineDepth() >= 20 }, "Engine stuck at depth \(engineDepth())")
        shoot("store-3-analysis")

        drag(from: "d1", to: "d4")
        XCTAssertTrue(waitUntil(timeout: 5) { self.element("square.d4").value as? String == "R" }, "Rxd4 not played")
        XCTAssertTrue(waitUntil(timeout: 180) { self.engineDepth() >= 20 }, "Engine stuck at depth \(engineDepth())")
        shoot("store-4-move")

        let history = app.buttons["scan.history"]
        for _ in 0..<4 where !(history.exists && history.isHittable) {
            app.navigationBars.buttons.element(boundBy: 0).tap()
            _ = history.waitForExistence(timeout: 2)
        }
        history.tap()
        XCTAssertTrue(app.buttons["history.row"].firstMatch.waitForExistence(timeout: 10))
        shoot("store-5-history")
    }

    // MARK: - Helpers

    private func launch(_ extra: [String: String]) {
        app = XCUIApplication()
        app.launchEnvironment = ["UITEST": "1", "UITEST_RESET": "1", "UITEST_ANIMATIONS": "1"]
            .merging(extra) { $1 }
        app.launch()
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func drag(from: String, to: String) {
        let start = element("square.\(from)").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = element("square.\(to)").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.15, thenDragTo: end)
    }

    private func engineDepth() -> Int {
        let depth = element("engine.depth")
        guard depth.exists else { return 0 }
        return Int(depth.value as? String ?? "") ?? 0
    }

    private func waitUntil(timeout: TimeInterval, _ condition: @escaping () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return condition()
    }

    /// Full-screen capture, status bar included, at the device's native resolution.
    private func shoot(_ name: String) {
        RunLoop.current.run(until: Date().addingTimeInterval(1)) // let animations settle
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
