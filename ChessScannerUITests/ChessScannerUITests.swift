import XCTest

/// End-to-end QA: scan a board photo → verify position → Stockfish analysis → history.
///
/// Fixtures are read from the host filesystem (the simulator shares it). CI writes
/// `Fixtures/expected.json` with the reference model's prediction for each fixture.
final class ChessScannerUITests: XCTestCase {
    private var app: XCUIApplication!

    private static let fixturesDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures")

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        if let app, app.state == .runningForeground {
            screenshot("zz-final-state")
        }
    }

    // MARK: - Tests

    func testScanPhysicalBoardToAnalysisAndHistory() throws {
        launch(scanning: "physical_board.png")
        screenshot("01-scanning")

        // 1. Scan lands on the editor.
        let editorTitle = app.navigationBars["Verify Position"]
        if !editorTitle.waitForExistence(timeout: 90) {
            let toast = app.descendants(matching: .any)["scan.toast"]
            XCTFail("Editor never appeared. Toast: \(toast.exists ? toast.label : "none")")
        }
        screenshot("02-editor")

        // 2. The recognized position matches the reference model.
        let placement = readBoardPlacement()
        attachText("recognized-placement", placement)
        XCTAssertEqual(placement.filter { $0 == "K" }.count, 1, "Expected exactly one white king: \(placement)")
        XCTAssertEqual(placement.filter { $0 == "k" }.count, 1, "Expected exactly one black king: \(placement)")
        if let expected = expectedPlacement(for: "physical_board.png") {
            let diff = squareDifferences(placement, expected)
            attachText("placement-diff", "app:      \(placement)\nexpected: \(expected)\ndiff: \(diff)")
            XCTAssertTrue(diff.isEmpty, "App differs from reference on \(diff.count) squares: \(diff)")
        }

        // 3. Analyze → Stockfish produces lines.
        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10), "Analysis screen did not open")
        XCTAssertEqual(app.navigationBars.matching(identifier: "Analysis").count, 1)

        let lines = app.descendants(matching: .any).matching(identifier: "engine.line")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "Stockfish produced no lines")
        screenshot("03-analysis-first-lines")

        let depth = app.staticTexts["engine.depth"]
        XCTAssertTrue(waitUntil(timeout: 60) { self.depthValue(depth) >= 12 },
                      "Engine depth stuck at \(depthValue(depth))")
        XCTAssertGreaterThanOrEqual(lines.count, 2, "Expected multiple engine lines (multipv 3)")
        attachText("engine-lines", (0..<lines.count).map { lines.element(boundBy: $0).label }.joined(separator: "\n"))
        screenshot("04-analysis-deep")

        // 4. Back to the camera screen; the scan is in history and reopens analysis.
        popToRoot()
        app.buttons["scan.history"].tap()
        let row = app.buttons["history.row"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Scan was not saved to history")
        XCTAssertEqual(app.buttons.matching(identifier: "history.row").count, 1)
        screenshot("05-history")

        row.tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10), "History item did not open analysis")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "No engine lines after reopening from history")
        screenshot("06-analysis-from-history")
    }

    func testEditorCorrectionsAndMoves() throws {
        launch(scanning: "physical_board.png")
        XCTAssertTrue(app.navigationBars["Verify Position"].waitForExistence(timeout: 90))

        // Reset to the start position, then play 1. e4 on the analysis board.
        app.buttons["editor.reset"].tap()
        XCTAssertEqual(readBoardPlacement(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
        screenshot("10-editor-reset")

        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10))
        square("e2").tap()
        square("e4").tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.square("e4").value as? String == "P" }, "e2-e4 was not played")
        XCTAssertEqual(square("e2").value as? String, "empty")
        let lines = app.descendants(matching: .any).matching(identifier: "engine.line")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "No engine lines after a move")
        screenshot("11-analysis-after-e4")
    }

    func testGalleryPickerFlow() throws {
        // Photos are added to the simulator library by CI (`simctl addmedia`).
        app = XCUIApplication()
        app.launchEnvironment = ["UITEST": "1", "UITEST_RESET": "1"]
        app.launch()

        app.buttons["scan.gallery"].tap()
        let photo = app.scrollViews.images.firstMatch
        guard photo.waitForExistence(timeout: 20) else {
            screenshot("20-picker-no-photos")
            throw XCTSkip("Photo picker showed no photos (library empty or picker not accessible)")
        }
        screenshot("20-picker")
        photo.tap()
        XCTAssertTrue(app.navigationBars["Verify Position"].waitForExistence(timeout: 90),
                      "Picking a photo did not reach the editor")
        screenshot("21-editor-from-gallery")
    }

    // MARK: - Helpers

    private func launch(scanning fixture: String) {
        let path = Self.fixturesDir.appendingPathComponent(fixture).path
        XCTAssertTrue(FileManager.default.fileExists(atPath: path), "Missing fixture \(path)")
        app = XCUIApplication()
        app.launchEnvironment = ["UITEST": "1", "UITEST_RESET": "1", "UITEST_SCAN_IMAGE": path]
        app.launch()
    }

    private func square(_ name: String) -> XCUIElement {
        app.descendants(matching: .any)["square.\(name)"].firstMatch
    }

    /// Reads the 64 square elements into a FEN piece-placement string.
    private func readBoardPlacement() -> String {
        XCTAssertTrue(square("a1").waitForExistence(timeout: 10), "Board squares not found")
        var ranks: [String] = []
        for rank in stride(from: 8, through: 1, by: -1) {
            var row = ""
            var empty = 0
            for file in "abcdefgh" {
                let value = square("\(file)\(rank)").value as? String ?? "empty"
                if value == "empty" {
                    empty += 1
                } else {
                    if empty > 0 { row += "\(empty)"; empty = 0 }
                    row += value
                }
            }
            if empty > 0 { row += "\(empty)" }
            ranks.append(row)
        }
        return ranks.joined(separator: "/")
    }

    private func expectedPlacement(for fixture: String) -> String? {
        let url = Self.fixturesDir.appendingPathComponent("expected.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let fen = json[fixture] else { return nil }
        return fen.components(separatedBy: " ").first
    }

    private func expand(_ placement: String) -> [Character] {
        placement.split(separator: "/").flatMap { rank in
            rank.flatMap { c -> [Character] in
                if let n = c.wholeNumberValue { return Array(repeating: ".", count: n) }
                return [c]
            }
        }
    }

    private func squareDifferences(_ a: String, _ b: String) -> [String] {
        let x = expand(a), y = expand(b)
        guard x.count == 64, y.count == 64 else { return ["malformed"] }
        return (0..<64).compactMap { i in
            guard x[i] != y[i] else { return nil }
            let file = "abcdefgh"[String.Index(utf16Offset: i % 8, in: "abcdefgh")]
            return "\(file)\(8 - i / 8): \(x[i]) vs \(y[i])"
        }
    }

    private func depthValue(_ element: XCUIElement) -> Int {
        guard element.exists else { return 0 }
        return Int(element.label.dropFirst()) ?? 0
    }

    private func popToRoot() {
        let history = app.buttons["scan.history"]
        for _ in 0..<5 {
            if history.exists && history.isHittable { break }
            let back = app.navigationBars.buttons.element(boundBy: 0)
            guard back.exists else { break }
            back.tap()
            _ = history.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(app.buttons["scan.history"].waitForExistence(timeout: 5), "Could not return to camera screen")
    }

    private func waitUntil(timeout: TimeInterval, _ condition: @escaping () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return condition()
    }

    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachText(_ name: String, _ text: String) {
        let attachment = XCTAttachment(string: text)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
