import Foundation

// MARK: - Piece Color

enum PieceColor: Int, CaseIterable, Codable {
    case white = 0
    case black = 1

    var opposite: PieceColor { self == .white ? .black : .white }
    var sign: Int { self == .white ? 1 : -1 }
    var name: String { self == .white ? "White" : "Black" }
}

// MARK: - Piece Type

enum PieceType: Int, CaseIterable, Codable {
    case pawn = 0
    case knight = 1
    case bishop = 2
    case rook = 3
    case queen = 4
    case king = 5

    var value: Int {
        switch self {
        case .pawn: return 100
        case .knight: return 320
        case .bishop: return 330
        case .rook: return 500
        case .queen: return 900
        case .king: return 20000
        }
    }

    var symbol: String {
        switch self {
        case .pawn: return ""
        case .knight: return "N"
        case .bishop: return "B"
        case .rook: return "R"
        case .queen: return "Q"
        case .king: return "K"
        }
    }

    var fenChar: Character {
        switch self {
        case .pawn: return "P"
        case .knight: return "N"
        case .bishop: return "B"
        case .rook: return "R"
        case .queen: return "Q"
        case .king: return "K"
        }
    }

    var fullName: String {
        switch self {
        case .pawn: return "Pawn"
        case .knight: return "Knight"
        case .bishop: return "Bishop"
        case .rook: return "Rook"
        case .queen: return "Queen"
        case .king: return "King"
        }
    }
}

// MARK: - Piece

struct Piece: Equatable, Codable {
    let type: PieceType
    let color: PieceColor

    var fenChar: Character {
        let c = type.fenChar
        return color == .white ? c : Character(String(c).lowercased())
    }

    var unicode: String {
        switch (color, type) {
        case (.white, .king): return "\u{2654}"
        case (.white, .queen): return "\u{2655}"
        case (.white, .rook): return "\u{2656}"
        case (.white, .bishop): return "\u{2657}"
        case (.white, .knight): return "\u{2658}"
        case (.white, .pawn): return "\u{2659}"
        case (.black, .king): return "\u{265A}"
        case (.black, .queen): return "\u{265B}"
        case (.black, .rook): return "\u{265C}"
        case (.black, .bishop): return "\u{265D}"
        case (.black, .knight): return "\u{265E}"
        case (.black, .pawn): return "\u{265F}"
        }
    }

    static func from(fen char: Character) -> Piece? {
        let isWhite = char.isUppercase
        let color: PieceColor = isWhite ? .white : .black
        let type: PieceType
        switch char.lowercased() {
        case "p": type = .pawn
        case "n": type = .knight
        case "b": type = .bishop
        case "r": type = .rook
        case "q": type = .queen
        case "k": type = .king
        default: return nil
        }
        return Piece(type: type, color: color)
    }
}

// MARK: - Square

struct Square: Hashable, Codable {
    let file: Int
    let rank: Int

    init(_ file: Int, _ rank: Int) {
        self.file = file
        self.rank = rank
    }

    var isValid: Bool {
        file >= 0 && file < 8 && rank >= 0 && rank < 8
    }

    var algebraic: String {
        guard isValid else { return "??" }
        let f = String(UnicodeScalar(97 + file)!)
        return "\(f)\(rank + 1)"
    }

    var isDark: Bool {
        (file + rank) % 2 == 0
    }

    static func fromAlgebraic(_ s: String) -> Square? {
        guard s.count == 2 else { return nil }
        let chars = Array(s)
        guard let asciiVal = chars[0].asciiValue else { return nil }
        let file = Int(asciiVal) - 97
        guard let rankVal = Int(String(chars[1])) else { return nil }
        let rank = rankVal - 1
        guard file >= 0, file < 8, rank >= 0, rank < 8 else { return nil }
        return Square(file, rank)
    }

    func offset(df: Int, dr: Int) -> Square {
        Square(file + df, rank + dr)
    }
}

// MARK: - Move

struct Move: Equatable {
    let from: Square
    let to: Square
    var promotion: PieceType?
    var piece: Piece
    var capturedPiece: Piece?
    var isCastling: Bool = false
    var isEnPassant: Bool = false
    var isDoublePawnPush: Bool = false

    var uci: String {
        var s = "\(from.algebraic)\(to.algebraic)"
        if let p = promotion {
            s += String(p.fenChar).lowercased()
        }
        return s
    }

    static func == (lhs: Move, rhs: Move) -> Bool {
        lhs.from == rhs.from && lhs.to == rhs.to && lhs.promotion == rhs.promotion
    }
}

// MARK: - Castling Rights

struct CastlingRights: Equatable, Codable {
    var whiteKingside: Bool = true
    var whiteQueenside: Bool = true
    var blackKingside: Bool = true
    var blackQueenside: Bool = true

    var fen: String {
        var s = ""
        if whiteKingside { s += "K" }
        if whiteQueenside { s += "Q" }
        if blackKingside { s += "k" }
        if blackQueenside { s += "q" }
        return s.isEmpty ? "-" : s
    }

    static func from(fen: String) -> CastlingRights {
        CastlingRights(
            whiteKingside: fen.contains("K"),
            whiteQueenside: fen.contains("Q"),
            blackKingside: fen.contains("k"),
            blackQueenside: fen.contains("q")
        )
    }
}

// MARK: - Position

class Position: ObservableObject {
    var board: [[Piece?]] = Array(repeating: Array(repeating: nil, count: 8), count: 8)
    var sideToMove: PieceColor = .white
    var castlingRights = CastlingRights()
    var enPassantSquare: Square?
    var halfMoveClock: Int = 0
    var fullMoveNumber: Int = 1

    static let startFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    init() {
        loadFEN(Position.startFEN)
    }

    init(fen: String) {
        loadFEN(fen)
    }

    func copy() -> Position {
        return Position(fen: self.fen)
    }

    // MARK: FEN

    var fen: String {
        var s = ""
        for rank in stride(from: 7, through: 0, by: -1) {
            var empty = 0
            for file in 0..<8 {
                if let piece = board[rank][file] {
                    if empty > 0 { s += "\(empty)"; empty = 0 }
                    s += String(piece.fenChar)
                } else {
                    empty += 1
                }
            }
            if empty > 0 { s += "\(empty)" }
            if rank > 0 { s += "/" }
        }
        s += " \(sideToMove == .white ? "w" : "b")"
        s += " \(castlingRights.fen)"
        s += " \(enPassantSquare?.algebraic ?? "-")"
        s += " \(halfMoveClock)"
        s += " \(fullMoveNumber)"
        return s
    }

    func loadFEN(_ fen: String) {
        let parts = fen.split(separator: " ")
        guard parts.count >= 4 else { return }

        board = Array(repeating: Array(repeating: nil, count: 8), count: 8)
        let ranks = parts[0].split(separator: "/")
        for (i, rankStr) in ranks.enumerated() {
            let rank = 7 - i
            var file = 0
            for char in rankStr {
                if let num = char.wholeNumberValue {
                    file += num
                } else if let piece = Piece.from(fen: char) {
                    if rank >= 0, rank < 8, file >= 0, file < 8 {
                        board[rank][file] = piece
                    }
                    file += 1
                }
            }
        }

        sideToMove = parts[1] == "w" ? .white : .black
        castlingRights = CastlingRights.from(fen: String(parts[2]))

        if parts[3] != "-" {
            enPassantSquare = Square.fromAlgebraic(String(parts[3]))
        } else {
            enPassantSquare = nil
        }

        if parts.count > 4 { halfMoveClock = Int(parts[4]) ?? 0 }
        if parts.count > 5 { fullMoveNumber = Int(parts[5]) ?? 1 }
    }

    // MARK: Board Access

    func piece(at square: Square) -> Piece? {
        guard square.isValid else { return nil }
        return board[square.rank][square.file]
    }

    func setPiece(_ piece: Piece?, at square: Square) {
        guard square.isValid else { return }
        board[square.rank][square.file] = piece
    }

    // MARK: King Finding

    func findKing(color: PieceColor) -> Square? {
        for rank in 0..<8 {
            for file in 0..<8 {
                if let p = board[rank][file], p.type == .king, p.color == color {
                    return Square(file, rank)
                }
            }
        }
        return nil
    }

    // MARK: Attack Detection

    func isSquareAttacked(_ square: Square, by color: PieceColor) -> Bool {
        let knightOffsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2),
                            (1, -2), (1, 2), (2, -1), (2, 1)]
        for (df, dr) in knightOffsets {
            let s = square.offset(df: df, dr: dr)
            if s.isValid, let p = piece(at: s), p.color == color, p.type == .knight {
                return true
            }
        }

        let pawnDir = color == .white ? -1 : 1
        for df in [-1, 1] {
            let s = square.offset(df: df, dr: pawnDir)
            if s.isValid, let p = piece(at: s), p.color == color, p.type == .pawn {
                return true
            }
        }

        for df in -1...1 {
            for dr in -1...1 {
                if df == 0, dr == 0 { continue }
                let s = square.offset(df: df, dr: dr)
                if s.isValid, let p = piece(at: s), p.color == color, p.type == .king {
                    return true
                }
            }
        }

        let diagonals = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        for (df, dr) in diagonals {
            var s = square.offset(df: df, dr: dr)
            while s.isValid {
                if let p = piece(at: s) {
                    if p.color == color, (p.type == .bishop || p.type == .queen) {
                        return true
                    }
                    break
                }
                s = s.offset(df: df, dr: dr)
            }
        }

        let straights = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        for (df, dr) in straights {
            var s = square.offset(df: df, dr: dr)
            while s.isValid {
                if let p = piece(at: s) {
                    if p.color == color, (p.type == .rook || p.type == .queen) {
                        return true
                    }
                    break
                }
                s = s.offset(df: df, dr: dr)
            }
        }

        return false
    }

    func isInCheck(color: PieceColor) -> Bool {
        guard let king = findKing(color: color) else { return false }
        return isSquareAttacked(king, by: color.opposite)
    }

    // MARK: Pseudo-Legal Move Generation

    func generatePseudoLegalMoves() -> [Move] {
        var moves: [Move] = []

        for rank in 0..<8 {
            for file in 0..<8 {
                guard let piece = board[rank][file], piece.color == sideToMove else { continue }
                let from = Square(file, rank)

                switch piece.type {
                case .pawn:
                    generatePawnMoves(from: from, piece: piece, moves: &moves)
                case .knight:
                    generateKnightMoves(from: from, piece: piece, moves: &moves)
                case .bishop:
                    generateSlidingMoves(from: from, piece: piece,
                                         directions: [(-1, -1), (-1, 1), (1, -1), (1, 1)],
                                         moves: &moves)
                case .rook:
                    generateSlidingMoves(from: from, piece: piece,
                                         directions: [(-1, 0), (1, 0), (0, -1), (0, 1)],
                                         moves: &moves)
                case .queen:
                    generateSlidingMoves(from: from, piece: piece,
                                         directions: [(-1, -1), (-1, 1), (1, -1), (1, 1),
                                                      (-1, 0), (1, 0), (0, -1), (0, 1)],
                                         moves: &moves)
                case .king:
                    generateKingMoves(from: from, piece: piece, moves: &moves)
                }
            }
        }

        return moves
    }

    private func generatePawnMoves(from: Square, piece: Piece, moves: inout [Move]) {
        let dir = piece.color == .white ? 1 : -1
        let startRank = piece.color == .white ? 1 : 6
        let promoRank = piece.color == .white ? 7 : 0

        let oneForward = from.offset(df: 0, dr: dir)
        if oneForward.isValid, self.piece(at: oneForward) == nil {
            if oneForward.rank == promoRank {
                for promoType: PieceType in [.queen, .rook, .bishop, .knight] {
                    moves.append(Move(from: from, to: oneForward, promotion: promoType, piece: piece))
                }
            } else {
                moves.append(Move(from: from, to: oneForward, piece: piece))

                if from.rank == startRank {
                    let twoForward = from.offset(df: 0, dr: dir * 2)
                    if twoForward.isValid, self.piece(at: twoForward) == nil {
                        moves.append(Move(from: from, to: twoForward, piece: piece, isDoublePawnPush: true))
                    }
                }
            }
        }

        for df in [-1, 1] {
            let capSquare = from.offset(df: df, dr: dir)
            guard capSquare.isValid else { continue }

            if let target = self.piece(at: capSquare), target.color != piece.color {
                if capSquare.rank == promoRank {
                    for promoType: PieceType in [.queen, .rook, .bishop, .knight] {
                        moves.append(Move(from: from, to: capSquare, promotion: promoType,
                                          piece: piece, capturedPiece: target))
                    }
                } else {
                    moves.append(Move(from: from, to: capSquare, piece: piece, capturedPiece: target))
                }
            }

            if let ep = enPassantSquare, capSquare == ep {
                let capturedPawnSquare = Square(ep.file, from.rank)
                let capturedPawn = self.piece(at: capturedPawnSquare)
                moves.append(Move(from: from, to: capSquare, piece: piece,
                                  capturedPiece: capturedPawn, isEnPassant: true))
            }
        }
    }

    private func generateKnightMoves(from: Square, piece: Piece, moves: inout [Move]) {
        let offsets = [(-2, -1), (-2, 1), (-1, -2), (-1, 2),
                       (1, -2), (1, 2), (2, -1), (2, 1)]
        for (df, dr) in offsets {
            let to = from.offset(df: df, dr: dr)
            guard to.isValid else { continue }
            let target = self.piece(at: to)
            if target == nil || target!.color != piece.color {
                moves.append(Move(from: from, to: to, piece: piece, capturedPiece: target))
            }
        }
    }

    private func generateSlidingMoves(from: Square, piece: Piece,
                                       directions: [(Int, Int)], moves: inout [Move]) {
        for (df, dr) in directions {
            var to = from.offset(df: df, dr: dr)
            while to.isValid {
                let target = self.piece(at: to)
                if let target = target {
                    if target.color != piece.color {
                        moves.append(Move(from: from, to: to, piece: piece, capturedPiece: target))
                    }
                    break
                }
                moves.append(Move(from: from, to: to, piece: piece))
                to = to.offset(df: df, dr: dr)
            }
        }
    }

    private func generateKingMoves(from: Square, piece: Piece, moves: inout [Move]) {
        for df in -1...1 {
            for dr in -1...1 {
                if df == 0, dr == 0 { continue }
                let to = from.offset(df: df, dr: dr)
                guard to.isValid else { continue }
                let target = self.piece(at: to)
                if target == nil || target!.color != piece.color {
                    moves.append(Move(from: from, to: to, piece: piece, capturedPiece: target))
                }
            }
        }

        if piece.color == .white {
            if castlingRights.whiteKingside, from == Square(4, 0) {
                if self.piece(at: Square(5, 0)) == nil,
                   self.piece(at: Square(6, 0)) == nil,
                   self.piece(at: Square(7, 0))?.type == .rook,
                   self.piece(at: Square(7, 0))?.color == .white {
                    if !isSquareAttacked(Square(4, 0), by: .black),
                       !isSquareAttacked(Square(5, 0), by: .black),
                       !isSquareAttacked(Square(6, 0), by: .black) {
                        moves.append(Move(from: from, to: Square(6, 0), piece: piece, isCastling: true))
                    }
                }
            }
            if castlingRights.whiteQueenside, from == Square(4, 0) {
                if self.piece(at: Square(3, 0)) == nil,
                   self.piece(at: Square(2, 0)) == nil,
                   self.piece(at: Square(1, 0)) == nil,
                   self.piece(at: Square(0, 0))?.type == .rook,
                   self.piece(at: Square(0, 0))?.color == .white {
                    if !isSquareAttacked(Square(4, 0), by: .black),
                       !isSquareAttacked(Square(3, 0), by: .black),
                       !isSquareAttacked(Square(2, 0), by: .black) {
                        moves.append(Move(from: from, to: Square(2, 0), piece: piece, isCastling: true))
                    }
                }
            }
        } else {
            if castlingRights.blackKingside, from == Square(4, 7) {
                if self.piece(at: Square(5, 7)) == nil,
                   self.piece(at: Square(6, 7)) == nil,
                   self.piece(at: Square(7, 7))?.type == .rook,
                   self.piece(at: Square(7, 7))?.color == .black {
                    if !isSquareAttacked(Square(4, 7), by: .white),
                       !isSquareAttacked(Square(5, 7), by: .white),
                       !isSquareAttacked(Square(6, 7), by: .white) {
                        moves.append(Move(from: from, to: Square(6, 7), piece: piece, isCastling: true))
                    }
                }
            }
            if castlingRights.blackQueenside, from == Square(4, 7) {
                if self.piece(at: Square(3, 7)) == nil,
                   self.piece(at: Square(2, 7)) == nil,
                   self.piece(at: Square(1, 7)) == nil,
                   self.piece(at: Square(0, 7))?.type == .rook,
                   self.piece(at: Square(0, 7))?.color == .black {
                    if !isSquareAttacked(Square(4, 7), by: .white),
                       !isSquareAttacked(Square(3, 7), by: .white),
                       !isSquareAttacked(Square(2, 7), by: .white) {
                        moves.append(Move(from: from, to: Square(2, 7), piece: piece, isCastling: true))
                    }
                }
            }
        }
    }

    // MARK: Legal Moves

    func legalMoves() -> [Move] {
        generatePseudoLegalMoves().filter { move in
            let newPos = makeMove(move)
            return !newPos.isInCheck(color: sideToMove)
        }
    }

    func legalMoves(from square: Square) -> [Move] {
        legalMoves().filter { $0.from == square }
    }

    // MARK: Make Move

    func makeMove(_ move: Move) -> Position {
        let newPos = self.copy()

        newPos.setPiece(nil, at: move.from)

        if let promoType = move.promotion {
            newPos.setPiece(Piece(type: promoType, color: move.piece.color), at: move.to)
        } else {
            newPos.setPiece(move.piece, at: move.to)
        }

        if move.isEnPassant {
            let capturedPawnSquare = Square(move.to.file, move.from.rank)
            newPos.setPiece(nil, at: capturedPawnSquare)
        }

        if move.isCastling {
            if move.to.file == 6 {
                let rookFrom = Square(7, move.to.rank)
                let rookTo = Square(5, move.to.rank)
                let rook = newPos.piece(at: rookFrom)
                newPos.setPiece(nil, at: rookFrom)
                newPos.setPiece(rook, at: rookTo)
            } else if move.to.file == 2 {
                let rookFrom = Square(0, move.to.rank)
                let rookTo = Square(3, move.to.rank)
                let rook = newPos.piece(at: rookFrom)
                newPos.setPiece(nil, at: rookFrom)
                newPos.setPiece(rook, at: rookTo)
            }
        }

        if move.piece.type == .king {
            if move.piece.color == .white {
                newPos.castlingRights.whiteKingside = false
                newPos.castlingRights.whiteQueenside = false
            } else {
                newPos.castlingRights.blackKingside = false
                newPos.castlingRights.blackQueenside = false
            }
        }
        if move.from == Square(0, 0) || move.to == Square(0, 0) {
            newPos.castlingRights.whiteQueenside = false
        }
        if move.from == Square(7, 0) || move.to == Square(7, 0) {
            newPos.castlingRights.whiteKingside = false
        }
        if move.from == Square(0, 7) || move.to == Square(0, 7) {
            newPos.castlingRights.blackQueenside = false
        }
        if move.from == Square(7, 7) || move.to == Square(7, 7) {
            newPos.castlingRights.blackKingside = false
        }

        if move.isDoublePawnPush {
            let dir = move.piece.color == .white ? 1 : -1
            newPos.enPassantSquare = Square(move.from.file, move.from.rank + dir)
        } else {
            newPos.enPassantSquare = nil
        }

        if move.piece.type == .pawn || move.capturedPiece != nil {
            newPos.halfMoveClock = 0
        } else {
            newPos.halfMoveClock = halfMoveClock + 1
        }

        if sideToMove == .black {
            newPos.fullMoveNumber = fullMoveNumber + 1
        }

        newPos.sideToMove = sideToMove.opposite

        return newPos
    }

    // MARK: Game State

    var isCheckmate: Bool {
        isInCheck(color: sideToMove) && legalMoves().isEmpty
    }

    var isStalemate: Bool {
        !isInCheck(color: sideToMove) && legalMoves().isEmpty
    }

    var isGameOver: Bool {
        isCheckmate || isStalemate || halfMoveClock >= 100
    }

    var gameResult: String? {
        if isCheckmate {
            return sideToMove == .white ? "0-1" : "1-0"
        }
        if isStalemate || halfMoveClock >= 100 {
            return "1/2-1/2"
        }
        return nil
    }

    // MARK: SAN Notation

    func san(for move: Move) -> String {
        if move.isCastling {
            return move.to.file == 6 ? "O-O" : "O-O-O"
        }

        var s = ""

        if move.piece.type != .pawn {
            s += move.piece.type.symbol

            let samePieceMoves = legalMoves().filter {
                $0.piece.type == move.piece.type &&
                $0.to == move.to &&
                $0.from != move.from
            }
            if !samePieceMoves.isEmpty {
                if samePieceMoves.allSatisfy({ $0.from.file != move.from.file }) {
                    s += String(UnicodeScalar(97 + move.from.file)!)
                } else if samePieceMoves.allSatisfy({ $0.from.rank != move.from.rank }) {
                    s += "\(move.from.rank + 1)"
                } else {
                    s += move.from.algebraic
                }
            }
        }

        if move.capturedPiece != nil || move.isEnPassant {
            if move.piece.type == .pawn {
                s += String(UnicodeScalar(97 + move.from.file)!)
            }
            s += "x"
        }

        s += move.to.algebraic

        if let promo = move.promotion {
            s += "=\(String(promo.fenChar))"
        }

        let newPos = makeMove(move)
        if newPos.isCheckmate {
            s += "#"
        } else if newPos.isInCheck(color: newPos.sideToMove) {
            s += "+"
        }

        return s
    }

    // MARK: Material Count

    func materialCount(for color: PieceColor) -> Int {
        var count = 0
        for rank in 0..<8 {
            for file in 0..<8 {
                if let p = board[rank][file], p.color == color {
                    count += p.type.value
                }
            }
        }
        return count
    }

    func pieceCounts(for color: PieceColor) -> [PieceType: Int] {
        var counts: [PieceType: Int] = [:]
        for rank in 0..<8 {
            for file in 0..<8 {
                if let p = board[rank][file], p.color == color, p.type != .king {
                    counts[p.type, default: 0] += 1
                }
            }
        }
        return counts
    }

    // MARK: UCI Move Parsing

    func moveFromUCI(_ uci: String) -> Move? {
        guard uci.count >= 4 else { return nil }
        let chars = Array(uci)

        guard let fromFile = Int(chars[0].asciiValue!) - 97 as Int?,
              let fromRank = Int(String(chars[1])),
              let toFile = Int(chars[2].asciiValue!) - 97 as Int?,
              let toRank = Int(String(chars[3])) else { return nil }

        let from = Square(fromFile, fromRank - 1)
        let to = Square(toFile, toRank - 1)

        guard from.isValid, to.isValid else { return nil }

        var promotion: PieceType?
        if uci.count == 5 {
            switch chars[4] {
            case "q": promotion = .queen
            case "r": promotion = .rook
            case "b": promotion = .bishop
            case "n": promotion = .knight
            default: break
            }
        }

        // Find matching legal move
        let legal = legalMoves()
        return legal.first { m in
            m.from == from && m.to == to && m.promotion == promotion
        }
    }

    // MARK: UCI Move Sequence to SAN

    func uciSequenceToSAN(_ uciMoves: [String]) -> String {
        var pos = self.copy()
        var sans: [String] = []
        for uci in uciMoves {
            guard let move = pos.moveFromUCI(uci) else { break }
            sans.append(pos.san(for: move))
            pos = pos.makeMove(move)
        }
        return sans.joined(separator: " ")
    }
}
