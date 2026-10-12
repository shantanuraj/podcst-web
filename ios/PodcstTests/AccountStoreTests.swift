import Foundation
import XCTest
@testable import Podcst

@MainActor
final class AccountStoreTests: XCTestCase {
    private let override = "https://example.com/override.xml"

    override func tearDown() {
        ContractURLProtocol.reset()
        super.tearDown()
    }

    func testServerDefaultsReplaceLocalDefaultsAndKeepOverrides() async throws {
        let (store, preferences, _) = signedIn([account(#"{"speed":1.25,"volumeBoost":false,"trimSilence":true}"#)])
        await store.load(accountID: "u1")
        XCTAssertEqual(preferences.defaults, AudioOptions(speed: 1.25, effects: AudioEffects(trimSilence: true)))
        XCTAssertEqual(preferences.options(for: override).speed, 2)
        XCTAssertEqual(store.account?.passkeys.map(\.provider), ["iCloud Keychain", nil])
        XCTAssertEqual(ContractURLProtocol.requests().count, 1)
    }

    func testUnsavedServerDefaultsReceiveTheLocalDefaults() async throws {
        let (store, _, _) = signedIn([account("null"), response(#"{"speed":0.75,"volumeBoost":false,"trimSilence":false}"#)])
        await store.load(accountID: "u1")
        let saved = try XCTUnwrap(ContractURLProtocol.requests().last)
        XCTAssertEqual(saved.httpMethod, "PUT")
        XCTAssertEqual(saved.url?.path, "/api/account/preferences")
        XCTAssertEqual(try body(saved), ["speed": 0.75, "volumeBoost": false, "trimSilence": false])
        XCTAssertEqual(store.account?.preferences?.speed, 0.75)
    }

    func testDefaultChangesAfterLoadAreUploaded() async throws {
        let (store, preferences, _) = signedIn([
            account(#"{"speed":0.75,"volumeBoost":false,"trimSilence":false}"#),
            response(#"{"speed":1.5,"volumeBoost":true,"trimSilence":false}"#),
        ])
        await store.load(accountID: "u1")
        preferences.set(AudioOptions(speed: 1.5, effects: AudioEffects(volumeBoost: true)))
        let saved = try await request(at: 1)
        XCTAssertEqual(try body(saved), ["speed": 1.5, "volumeBoost": true, "trimSilence": false])
        preferences.set(AudioOptions(speed: 2), for: override)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(ContractURLProtocol.requests().count, 2)
    }

    func testRemovingAPasskeyDropsItFromTheAccount() async throws {
        let (store, _, _) = signedIn([account(#"{"speed":1,"volumeBoost":false,"trimSilence":false}"#), response(#"{"success":true}"#)])
        await store.load(accountID: "u1")
        let legacy = try XCTUnwrap(store.account?.passkeys.last)
        try await store.removePasskey(legacy)
        XCTAssertEqual(ContractURLProtocol.requests().last?.url?.path, "/api/account/passkeys/pk-legacy")
        XCTAssertEqual(ContractURLProtocol.requests().last?.httpMethod, "DELETE")
        XCTAssertEqual(store.account?.passkeys.map(\.id), ["pk-mac"])
    }

    private func signedIn(_ responses: [ContractResponse]) -> (AccountStore, AudioPreferences, APIClient) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        let api = APIClient(
            baseURL: URL(string: "https://account-\(UUID().uuidString).example.test")!,
            session: URLSession(configuration: configuration),
            keychain: ContractCredentials(value: "fixture-session")
        )
        api.restoreAccount("u1")
        let preferences = AudioPreferences()
        preferences.set(AudioOptions(speed: 0.75))
        preferences.set(AudioOptions(speed: 2), for: override)
        ContractURLProtocol.install(responses)
        return (AccountStore(api: api, preferences: preferences), preferences, api)
    }

    private func account(_ preferences: String) -> ContractResponse {
        response("""
        {"createdAt":"2024-03-02T10:00:00.000Z","passkeys":[
        {"id":"pk-mac","provider":"iCloud Keychain","createdAt":"2024-03-02T10:05:00.000Z","lastUsedAt":"2026-10-05T08:00:00.000Z"},
        {"id":"pk-legacy","provider":null,"createdAt":"2025-06-10T12:00:00.000Z","lastUsedAt":null}],
        "preferences":\(preferences)}
        """)
    }

    private func response(_ json: String) -> ContractResponse {
        ContractResponse(status: 200, data: Data(json.utf8))
    }

    private func request(at index: Int) async throws -> URLRequest {
        for _ in 0..<100 {
            let requests = ContractURLProtocol.requests()
            if requests.count > index { return requests[index] }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw XCTSkip("Request \(index) was never sent")
    }

    private func body(_ request: URLRequest) throws -> NSDictionary {
        let data: Data
        if let body = request.httpBody { data = body }
        else {
            let stream = try XCTUnwrap(request.httpBodyStream)
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            var collected = Data()
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                collected.append(buffer, count: count)
            }
            data = collected
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
    }
}
