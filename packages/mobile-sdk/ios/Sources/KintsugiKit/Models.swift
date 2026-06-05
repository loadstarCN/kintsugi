import Foundation

public struct Empty: Codable {}

public struct FilterClause: Codable {
    public let field: String
    public let op: String
    public let value: AnyCodable?

    public init(field: String, op: String, value: AnyCodable? = nil) {
        self.field = field
        self.op = op
        self.value = value
    }
}

public struct SortOrder: Codable {
    public let field: String
    public let direction: String?
    public init(field: String, direction: String? = nil) {
        self.field = field
        self.direction = direction
    }
}

public struct FilterRequest: Codable {
    public var wheres: [FilterClause]?
    public var orderBy: [SortOrder]?
    public var page: Int?
    public var pageSize: Int?
    public var select: [String]?
    public var includeDeleted: Bool?

    enum CodingKeys: String, CodingKey {
        case wheres = "where"
        case orderBy, page, pageSize, select, includeDeleted
    }

    public init(
        wheres: [FilterClause]? = nil,
        orderBy: [SortOrder]? = nil,
        page: Int? = nil,
        pageSize: Int? = nil,
        select: [String]? = nil,
        includeDeleted: Bool? = nil
    ) {
        self.wheres = wheres
        self.orderBy = orderBy
        self.page = page
        self.pageSize = pageSize
        self.select = select
        self.includeDeleted = includeDeleted
    }
}

public struct FilterResult<T: Decodable>: Decodable {
    public let data: [T]
    public let total: Int
    public let page: Int
    public let pageSize: Int
}

public struct DeleteResult: Decodable {
    public let ok: Bool
    public let softDeleted: Bool
}

public struct ChatsAskRequest: Codable {
    public let appCode: String
    public let question: String
    public let maxTables: Int?
}

public struct ChatsAskResult: Decodable {
    public let sql: String
    public let explanation: String
    public let rowCount: Int
}

/// 让任意 JSON 能跨 Codable（FilterClause.value 经常是字符串/数字/布尔混合）
public struct AnyCodable: Codable {
    public let value: Any

    public init<T>(_ v: T) { self.value = v }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { value = b; return }
        if let i = try? c.decode(Int.self) { value = i; return }
        if let d = try? c.decode(Double.self) { value = d; return }
        if let s = try? c.decode(String.self) { value = s; return }
        if let a = try? c.decode([AnyCodable].self) { value = a.map { $0.value }; return }
        if let o = try? c.decode([String: AnyCodable].self) { value = o.mapValues { $0.value }; return }
        value = NSNull()
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let b as Bool: try c.encode(b)
        case let i as Int: try c.encode(i)
        case let d as Double: try c.encode(d)
        case let s as String: try c.encode(s)
        case let a as [Any]: try c.encode(a.map { AnyCodable($0) })
        case let o as [String: Any]: try c.encode(o.mapValues { AnyCodable($0) })
        default: try c.encodeNil()
        }
    }
}
