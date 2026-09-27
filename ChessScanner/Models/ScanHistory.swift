import Foundation

struct ScanHistoryItem: Identifiable, Codable {
    let id: UUID
    let fen: String
    let timestamp: Date
    var label: String?

    init(fen: String, label: String? = nil) {
        self.id = UUID()
        self.fen = fen
        self.timestamp = Date()
        self.label = label
    }
}

@MainActor
class ScanHistoryStore: ObservableObject {
    @Published var items: [ScanHistoryItem] = []

    private let key = "chess_scan_history"

    init() {
        load()
    }

    func addItem(fen: String, label: String? = nil) {
        let item = ScanHistoryItem(fen: fen, label: label)
        items.insert(item, at: 0)
        save()
    }

    func removeItem(_ item: ScanHistoryItem) {
        items.removeAll { $0.id == item.id }
        save()
    }

    func clearAll() {
        items.removeAll()
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([ScanHistoryItem].self, from: data) else {
            return
        }
        items = decoded
    }
}
