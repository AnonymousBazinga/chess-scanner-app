import Foundation

extension Position {
    /// Problems that stop the position from being analyzed, most important first.
    var validationIssues: [String] {
        var issues: [String] = []
        for color in [PieceColor.white, .black] {
            // `pieceCounts` leaves kings out, so count them directly.
            let kings = board.joined().filter { $0 == Piece(type: .king, color: color) }.count
            if kings == 0 { issues.append("\(color.name) needs a king") }
            if kings > 1 { issues.append("\(color.name) has \(kings) kings") }
            let pawns = pieceCounts(for: color)[.pawn] ?? 0
            if pawns > 8 { issues.append("\(color.name) has more than 8 pawns") }
            let total = pieceCounts(for: color).values.reduce(0, +) + kings
            if total > 16 { issues.append("\(color.name) has more than 16 pieces") }
        }
        for file in 0..<8 {
            for rank in [0, 7] where board[rank][file]?.type == .pawn {
                issues.append("Pawns can't be on the first or last rank")
                return issues
            }
        }
        if issues.isEmpty, isInCheck(color: sideToMove.opposite) {
            issues.append("\(sideToMove.opposite.name) is in check but it's \(sideToMove.name)'s move")
        }
        return issues
    }

    /// Squares holding pieces that make the position illegal: pawns on the back
    /// ranks and any king beyond the first of its color.
    var illegalSquares: Set<Square> {
        var result: Set<Square> = []
        var kingsSeen: Set<Int> = []
        for rank in 0..<8 {
            for file in 0..<8 {
                guard let piece = board[rank][file] else { continue }
                if piece.type == .pawn && (rank == 0 || rank == 7) { result.insert(Square(file, rank)) }
                if piece.type == .king && !kingsSeen.insert(piece.color.rawValue).inserted {
                    result.insert(Square(file, rank))
                }
            }
        }
        return result
    }

    /// Castling rights that are still possible given where kings and rooks stand.
    func possibleCastling() -> CastlingRights {
        var rights = CastlingRights()
        let whiteKing = board[0][4] == Piece(type: .king, color: .white)
        let blackKing = board[7][4] == Piece(type: .king, color: .black)
        rights.whiteKingside = whiteKing && board[0][7] == Piece(type: .rook, color: .white)
        rights.whiteQueenside = whiteKing && board[0][0] == Piece(type: .rook, color: .white)
        rights.blackKingside = blackKing && board[7][7] == Piece(type: .rook, color: .black)
        rights.blackQueenside = blackKing && board[7][0] == Piece(type: .rook, color: .black)
        return rights
    }

    /// Drops castling rights and en passant squares the current placement no longer allows.
    func sanitizeRights() {
        let possible = possibleCastling()
        castlingRights.whiteKingside = castlingRights.whiteKingside && possible.whiteKingside
        castlingRights.whiteQueenside = castlingRights.whiteQueenside && possible.whiteQueenside
        castlingRights.blackKingside = castlingRights.blackKingside && possible.blackKingside
        castlingRights.blackQueenside = castlingRights.blackQueenside && possible.blackQueenside
        enPassantSquare = nil
    }

    func clearBoard() {
        board = Array(repeating: Array(repeating: nil, count: 8), count: 8)
        castlingRights = CastlingRights(whiteKingside: false, whiteQueenside: false,
                                        blackKingside: false, blackQueenside: false)
        enPassantSquare = nil
    }
}
