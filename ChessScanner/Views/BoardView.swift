import SwiftUI

struct BoardView: View {
    @ObservedObject var position: Position
    let flipped: Bool
    var selectedSquare: Square?
    var legalMoveSquares: [Square] = []
    var lastMove: (from: Square, to: Square)?
    var onSquareTap: ((Square) -> Void)?
    var interactive: Bool = true

    private let coordFont = Font.system(size: 10, weight: .medium, design: .rounded)

    var body: some View {
        GeometryReader { geo in
            let boardSize = min(geo.size.width, geo.size.height)
            let squareSize = boardSize / 8

            VStack(spacing: 0) {
                ForEach(0..<8, id: \.self) { row in
                    HStack(spacing: 0) {
                        ForEach(0..<8, id: \.self) { col in
                            let file = flipped ? (7 - col) : col
                            let rank = flipped ? row : (7 - row)
                            let square = Square(file, rank)
                            let isDark = square.isDark
                            let piece = position.piece(at: square)

                            squareView(
                                square: square,
                                piece: piece,
                                isDark: isDark,
                                squareSize: squareSize,
                                row: row,
                                col: col
                            )
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(NotionTheme.border, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    @ViewBuilder
    private func squareView(square: Square, piece: Piece?, isDark: Bool,
                            squareSize: CGFloat, row: Int, col: Int) -> some View {
        let isSelected = selectedSquare == square
        let isLegalMove = legalMoveSquares.contains(square)
        let isLastMoveFrom = lastMove?.from == square
        let isLastMoveTo = lastMove?.to == square
        let isKingInCheck = piece?.type == .king &&
            piece?.color == position.sideToMove &&
            position.isInCheck(color: position.sideToMove)

        ZStack {
            // Square background
            Rectangle()
                .fill(squareColor(isDark: isDark, isSelected: isSelected,
                                  isLastMove: isLastMoveFrom || isLastMoveTo,
                                  isCheck: isKingInCheck))

            // Piece
            if let piece = piece {
                PieceView(piece: piece, size: squareSize * 0.75)
                    .allowsHitTesting(false)
            }

            // Legal move indicator
            if isLegalMove {
                if piece != nil {
                    // Capture indicator
                    RoundedRectangle(cornerRadius: 1)
                        .strokeBorder(BoardColors.legalMoveIndicator, lineWidth: squareSize * 0.08)
                } else {
                    // Move indicator - centered dot
                    Circle()
                        .fill(BoardColors.legalMoveIndicator)
                        .frame(width: squareSize * 0.3, height: squareSize * 0.3)
                }
            }

            // Coordinate labels
            VStack {
                HStack {
                    Spacer()
                    if col == 7 {
                        let rankLabel = flipped ? "\(8 - (7 - row))" : "\(8 - row)"
                        Text(rankLabel)
                            .font(coordFont)
                            .foregroundStyle(isDark ? BoardColors.lightSquare.opacity(0.7) :
                                                BoardColors.darkSquare.opacity(0.7))
                            .padding(2)
                    }
                }
                Spacer()
                HStack {
                    if row == 7 {
                        let fileLabel = flipped ? String(UnicodeScalar(104 - col)!) :
                                                  String(UnicodeScalar(97 + col)!)
                        Text(fileLabel)
                            .font(coordFont)
                            .foregroundStyle(isDark ? BoardColors.lightSquare.opacity(0.7) :
                                                BoardColors.darkSquare.opacity(0.7))
                            .padding(2)
                    }
                    Spacer()
                }
            }
        }
        .frame(width: squareSize, height: squareSize)
        .contentShape(Rectangle())
        .onTapGesture {
            if interactive {
                onSquareTap?(square)
            }
        }
    }

    private func squareColor(isDark: Bool, isSelected: Bool, isLastMove: Bool, isCheck: Bool) -> Color {
        if isCheck {
            return BoardColors.checkHighlight
        }
        if isSelected {
            return isDark ? BoardColors.selectedSquare.opacity(0.7) : BoardColors.selectedSquare
        }
        if isLastMove {
            return isDark ?
                Color(red: 0.58, green: 0.64, blue: 0.34) :
                Color(red: 0.94, green: 0.94, blue: 0.68)
        }
        return isDark ? BoardColors.darkSquare : BoardColors.lightSquare
    }
}

#Preview {
    BoardView(
        position: Position(),
        flipped: false
    )
    .padding()
    .background(NotionTheme.background)
}
