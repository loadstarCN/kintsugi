import Foundation
import CryptoKit

/// Kintsugi iOS SDK —— 对齐 @kintsugi/sdk 的 Instant API 形状。
///
/// 用法：
///   let client = KintsugiClient(
///       baseURL: URL(string: "https://api.kintsugi.example.com")!,
///       appCode: "app-demo0001",
///       auth: .token("eyJ...")
///   )
///   let result: FilterResult<Goods> = try await client.filter(datasetCode: "dsxxx", body: .init(pageSize: 20))

public enum KintsugiAuth {
    case none
    case token(String)
    /// HMAC-SHA256 签名模式（对应服务端 AccessKey）
    case accessKey(key: String, secret: String)
}

public struct KintsugiClient {
    public let baseURL: URL
    public let appCode: String
    public var auth: KintsugiAuth
    public var session: URLSession

    public init(baseURL: URL, appCode: String, auth: KintsugiAuth = .none, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.appCode = appCode
        self.auth = auth
        self.session = session
    }

    // MARK: - Instant API

    public func filter<T: Decodable>(datasetCode: String, body: FilterRequest) async throws -> FilterResult<T> {
        try await request("POST", path: "/api/apps/\(appCode)/ds/\(datasetCode)/filter", body: body)
    }

    public func getOne<T: Decodable>(datasetCode: String, id: String) async throws -> T {
        try await request("GET", path: "/api/apps/\(appCode)/ds/\(datasetCode)/\(id)", body: Empty())
    }

    public func create<In: Encodable, Out: Decodable>(datasetCode: String, data: In) async throws -> Out {
        try await request("POST", path: "/api/apps/\(appCode)/ds/\(datasetCode)", body: data)
    }

    public func update<In: Encodable, Out: Decodable>(datasetCode: String, id: String, data: In) async throws -> Out {
        try await request("PATCH", path: "/api/apps/\(appCode)/ds/\(datasetCode)/\(id)", body: data)
    }

    public func delete(datasetCode: String, id: String) async throws -> DeleteResult {
        try await request("DELETE", path: "/api/apps/\(appCode)/ds/\(datasetCode)/\(id)", body: Empty())
    }

    // MARK: - Chats

    public func askChats(question: String) async throws -> ChatsAskResult {
        try await request("POST", path: "/api/chats/ask", body: ChatsAskRequest(appCode: appCode, question: question, maxTables: nil))
    }

    // MARK: - Core

    public func request<In: Encodable, Out: Decodable>(_ method: String, path: String, body: In) async throws -> Out {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        var bodyData: Data = Data()
        if method != "GET" && !(body is Empty) {
            bodyData = try JSONEncoder().encode(body)
            req.httpBody = bodyData
        }

        switch auth {
        case .none: break
        case .token(let t):
            req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
        case .accessKey(let key, let secret):
            let ts = String(Int(Date().timeIntervalSince1970))
            let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16).lowercased()
            let bodyStr = String(data: bodyData, encoding: .utf8) ?? ""
            let canonical = "\(method.uppercased())\n\(path)\n\(ts)\n\(nonce)\n\(bodyStr)"
            let sig = hmacSHA256(key: secret, message: canonical)
            req.setValue(key, forHTTPHeaderField: "X-Access-Key")
            req.setValue(ts, forHTTPHeaderField: "X-Timestamp")
            req.setValue(String(nonce), forHTTPHeaderField: "X-Nonce")
            req.setValue(sig, forHTTPHeaderField: "X-Signature")
        }

        let (data, res) = try await session.data(for: req)
        guard let http = res as? HTTPURLResponse else {
            throw KintsugiError.network("no http response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw KintsugiError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try JSONDecoder().decode(Out.self, from: data)
    }
}

private func hmacSHA256(key: String, message: String) -> String {
    let keyData = Data(key.utf8)
    let msgData = Data(message.utf8)
    let sig = HMAC<SHA256>.authenticationCode(for: msgData, using: SymmetricKey(data: keyData))
    return sig.map { String(format: "%02x", $0) }.joined()
}

public enum KintsugiError: Error {
    case network(String)
    case http(status: Int, body: String)
}
