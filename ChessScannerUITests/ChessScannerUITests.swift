import XCTest

/// End-to-end QA: scan → review/fix → Stockfish analysis → history, plus editing,
/// drag moves and promotion. Screenshots are attached at each step for review.
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

    // MARK: - Scan flow

    func testScanPhysicalBoardToAnalysisAndHistory() throws {
        launch(scanning: "physical_board.png")
        screenshot("01-scanning")

        let editorTitle = app.navigationBars["Review Position"]
        if !editorTitle.waitForExistence(timeout: 90) {
            let toast = element("scan.toast")
            XCTFail("Editor never appeared. Toast: \(toast.exists ? toast.label : "none")")
        }
        screenshot("02-editor-after-scan")

        // The app's recognition matches the reference model on the same photo.
        let placement = readBoardPlacement()
        attachText("recognized-placement", placement)
        if let expected = expectedPlacement(for: "physical_board.png") {
            let diff = squareDifferences(placement, expected)
            attachText("placement-diff", "app:      \(placement)\nexpected: \(expected)\ndiff: \(diff)")
            // Core Graphics and PIL resample slightly differently, which can flip a
            // borderline square; anything more means the preprocessing diverged.
            XCTAssertLessThanOrEqual(diff.count, 3, "App differs from reference on \(diff.count) squares: \(diff)")
        }

        // Fix an illegal scan the way a user would: erase pawns on the back ranks.
        fixIllegalScan(placement)
        screenshot("03-editor-fixed")
        XCTAssertFalse(element("editor.issue").exists, "Position still invalid: \(element("editor.issue").label)")

        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10), "Analysis screen did not open")
        XCTAssertEqual(app.navigationBars.matching(identifier: "Analysis").count, 1)

        let lines = app.descendants(matching: .any).matching(identifier: "engine.line")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "Stockfish produced no lines")
        screenshot("04-analysis-first-lines")

        XCTAssertTrue(waitUntil(timeout: 60) { self.engineDepth() >= 12 }, "Engine depth stuck at \(engineDepth())")
        XCTAssertTrue(waitUntil(timeout: 20) { lines.count >= 3 }, "Expected 3 engine lines, got \(lines.count)")
        attachText("engine-lines", (0..<lines.count).map { lines.element(boundBy: $0).label }.joined(separator: "\n"))
        let bar = element("eval.bar")
        XCTAssertTrue(bar.exists)
        XCTAssertNotEqual(bar.value as? String, "pending")
        screenshot("05-analysis-deep")

        // Back to the camera screen; the scan is in history and reopens analysis.
        popToRoot()
        app.buttons["scan.history"].tap()
        let row = app.buttons["history.row"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Scan was not saved to history")
        XCTAssertEqual(app.buttons.matching(identifier: "history.row").count, 1)
        screenshot("06-history")

        row.tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10), "History item did not open analysis")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "No engine lines after reopening from history")
        screenshot("07-analysis-from-history")
    }

    // MARK: - Manual setup, editing and moves

    func testManualSetupEditingAndMoves() throws {
        launch()
        XCTAssertTrue(app.buttons["scan.manual"].waitForExistence(timeout: 10))
        screenshot("10-landing")

        app.buttons["scan.manual"].tap()
        XCTAssertTrue(app.navigationBars["Review Position"].waitForExistence(timeout: 10))
        XCTAssertEqual(readBoardPlacement(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
        screenshot("11-editor-start")

        // Palette: place a black queen on d4, then erase it, then undo the erase.
        app.buttons["palette.bQ"].tap()
        square("d4").tap()
        XCTAssertEqual(square("d4").value as? String, "q")
        app.buttons["tool.erase"].tap()
        square("d4").tap()
        XCTAssertEqual(square("d4").value as? String, "empty")
        app.buttons["editor.undo"].tap()
        XCTAssertEqual(square("d4").value as? String, "q")
        screenshot("12-editor-palette")

        // Validation: clearing the board blocks analysis until kings are placed.
        app.buttons["editor.clear"].tap()
        XCTAssertTrue(element("editor.issue").waitForExistence(timeout: 3), "No validation message on empty board")
        XCTAssertFalse(app.buttons["editor.analyze"].isEnabled)
        screenshot("13-editor-invalid")

        app.buttons["editor.reset"].tap()
        XCTAssertTrue(waitUntil(timeout: 3) { !self.element("editor.issue").exists })
        XCTAssertTrue(app.buttons["editor.analyze"].isEnabled)

        // Move a piece in the editor by dragging (knight g1 → f3).
        app.buttons["tool.move"].tap()
        drag(from: "g1", to: "f3")
        XCTAssertTrue(waitUntil(timeout: 3) { self.square("f3").value as? String == "N" }, "Editor drag failed")
        app.buttons["editor.undo"].tap()
        XCTAssertEqual(square("g1").value as? String, "N")

        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10))

        // Tap-tap move 1. e4, then drag 1... e5.
        square("e2").tap()
        square("e4").tap()
        XCTAssertTrue(waitUntil(timeout: 5) { self.square("e4").value as? String == "P" }, "e2-e4 was not played")
        drag(from: "e7", to: "e5")
        XCTAssertTrue(waitUntil(timeout: 5) { self.square("e5").value as? String == "p" }, "Drag e7-e5 was not played")
        XCTAssertTrue(app.buttons["move.1"].waitForExistence(timeout: 3), "Move list missing")

        // Illegal drag snaps back.
        drag(from: "d2", to: "d5")
        XCTAssertEqual(square("d2").value as? String, "P")
        XCTAssertEqual(square("d5").value as? String, "empty")

        let lines = app.descendants(matching: .any).matching(identifier: "engine.line")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 60), "No engine lines after moves")
        screenshot("14-analysis-after-e4-e5")

        // Navigate back and forward through the moves.
        app.buttons["analysis.back"].tap()
        XCTAssertEqual(square("e5").value as? String, "empty")
        app.buttons["analysis.forward"].tap()
        XCTAssertEqual(square("e5").value as? String, "p")

        // Flip the board.
        app.buttons["analysis.flip"].tap()
        screenshot("15-analysis-flipped")

        // Engine toggle.
        app.switches["engine.toggle"].tap()
        XCTAssertTrue(waitUntil(timeout: 3) { lines.count == 0 }, "Lines still shown with engine off")
        screenshot("16-engine-off")
    }

    func testPromotion() throws {
        launch()
        app.buttons["scan.manual"].tap()
        XCTAssertTrue(app.navigationBars["Review Position"].waitForExistence(timeout: 10))

        app.buttons["editor.clear"].tap()
        app.buttons["palette.wK"].tap(); square("e1").tap()
        app.buttons["palette.bK"].tap(); square("h8").tap()
        app.buttons["palette.wP"].tap(); square("a7").tap()
        XCTAssertTrue(waitUntil(timeout: 3) { !self.element("editor.issue").exists }, "Position should be valid")
        app.buttons["editor.analyze"].tap()
        XCTAssertTrue(app.navigationBars["Analysis"].waitForExistence(timeout: 10))

        square("a7").tap()
        square("a8").tap()
        let knight = app.buttons["promote.knight"]
        XCTAssertTrue(knight.waitForExistence(timeout: 3), "Promotion picker did not appear")
        screenshot("20-promotion-picker")
        knight.tap()
        XCTAssertTrue(waitUntil(timeout: 3) { self.square("a8").value as? String == "N" }, "Underpromotion failed")
        screenshot("21-after-promotion")
    }

    func testGalleryPickerFlow() throws {
        // Photos are added to the simulator library by CI (`simctl addmedia`).
        launch()
        app.buttons["scan.gallery"].tap()
        // The picker runs out of process; wait for its grid, then tap the first cell
        // (the chess fixture, the only photo CI adds besides the simulator samples).
        let grid = app.scrollViews.firstMatch
        guard grid.waitForExistence(timeout: 20) else {
            screenshot("30-picker-no-photos")
            throw XCTSkip("Photo picker not accessible")
        }
        sleep(2)
        screenshot("30-picker")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.165, dy: 0.43)).tap()
        XCTAssertTrue(app.navigationBars["Review Position"].waitForExistence(timeout: 90),
                      "Picking a photo did not reach the editor")
        XCTAssertTrue(app.buttons["editor.photo"].exists, "Scanned photo not shown for comparison")
        screenshot("31-editor-from-gallery")
    }

    // MARK: - Helpers

    private func launch(scanning fixture: String? = nil) {
        app = XCUIApplication()
        var env = ["UITEST": "1", "UITEST_RESET": "1"]
        if let fixture {
            let path = Self.fixturesDir.appendingPathComponent(fixture).path
            XCTAssertTrue(FileManager.default.fileExists(atPath: path), "Missing fixture \(path)")
            env["UITEST_SCAN_IMAGE"] = path
        }
        app.launchEnvironment = env
        app.launch()
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func square(_ name: String) -> XCUIElement {
        element("square.\(name)")
    }

    private func drag(from: String, to: String) {
        let start = square(from).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = square(to).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.15, thenDragTo: end)
    }

    private func engineDepth() -> Int {
        let depth = element("engine.depth")
        guard depth.exists else { return 0 }
        return Int(depth.value as? String ?? "") ?? 0
    }

    /// Erases pawns on the first/last rank and extra kings so the scan becomes analyzable.
    private func fixIllegalScan(_ placement: String) {
        guard element("editor.issue").exists else { return }
        let board = expand(placement)
        var erase: [String] = []
        var kings: [Character: Int] = [:]
        for i in 0..<64 {
            let name = "\("abcdefgh".map { $0 }[i % 8])\(8 - i / 8)"
            let c = board[i]
            if (c == "p" || c == "P") && (i / 8 == 0 || i / 8 == 7) { erase.append(name) }
            if c == "k" || c == "K" {
                kings[c, default: 0] += 1
                if kings[c]! > 1 { erase.append(name) }
            }
        }
        if !erase.isEmpty {
            app.buttons["tool.erase"].tap()
            for name in erase { square(name).tap() }
        }
        if !kings.keys.contains("K") { app.buttons["palette.wK"].tap(); square(firstEmpty(board)).tap() }
        if !kings.keys.contains("k") { app.buttons["palette.bK"].tap(); square(firstEmpty(expand(readBoardPlacement()))).tap() }
        if element("editor.issue").exists, element("editor.issue").label.contains("move") {
            let black = app.buttons["editor.side.black"]
            black.isSelected ? app.buttons["editor.side.white"].tap() : black.tap()
        }
        if element("editor.issue").exists {
            attachText("unfixable-scan", element("editor.issue").label)
            app.buttons["editor.reset"].tap()
        }
    }

    private func firstEmpty(_ board: [Character]) -> String {
        let i = board.firstIndex(of: ".") ?? 36
        return "\("abcdefgh".map { $0 }[i % 8])\(8 - i / 8)"
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
        let files = Array("abcdefgh")
        return (0..<64).compactMap { i in
            guard x[i] != y[i] else { return nil }
            return "\(files[i % 8])\(8 - i / 8): \(x[i]) vs \(y[i])"
        }
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
        XCTAssertTrue(history.waitForExistence(timeout: 5), "Could not return to camera screen")
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
