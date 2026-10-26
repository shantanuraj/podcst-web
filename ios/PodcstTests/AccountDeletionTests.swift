import Foundation
import XCTest
@testable import Podcst

@MainActor
final class AccountDeletionTests: XCTestCase {
    private var directory: URL!
    private var api: APIClient!
    private var session: SessionStore!
    private var store: AccountDeletionStore!
    private let operation = "00000000-0000-4000-8000-000000000001"

    override func setUp() async throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        api = APIClient(baseURL: URL(string: "https://deletion.example.test")!, session: URLSession(configuration: configuration), keychain: ContractCredentials(value: "synthetic-session"))
        session = SessionStore(api: api, storageURL: directory.appendingPathComponent("session.json"))
        ContractURLProtocol.install([response(#"{"user":{"id":"a","email":"a@example.test","hasPasskey":false}}"#)])
        await session.restore()
        store = AccountDeletionStore(api: api, session: session, url: directory.appendingPathComponent("deletion.json"))
        store.suspend = { _ in }
    }

    override func tearDown() {
        ContractURLProtocol.reset()
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    func testLostResponseSurvivesRestartAndUnknownCannotErase() async throws {
        ContractURLProtocol.install([prepared(), response("{}", status: 503)])
        await store.prepare(account: "a")
        await store.submit(account: "a", code: "123456")
        XCTAssertEqual(store.records.first?.outcome, .unknown)
        let source = try String(contentsOf: directory.appendingPathComponent("deletion.json"), encoding: .utf8)
        XCTAssertFalse(source.contains("123456"))
        let restarted = AccountDeletionStore(api: api, session: session, url: directory.appendingPathComponent("deletion.json"))
        var steps: [AccountDeletion.Cleanup] = []
        restarted.clean = { account, step in XCTAssertEqual(account, "a"); steps.append(step) }
        ContractURLProtocol.install([response(#"{"status":"unknown"}"#)])
        await restarted.resume()
        XCTAssertTrue(steps.isEmpty)
        ContractURLProtocol.install([response(#"{"status":"completed"}"#)])
        await restarted.resume()
        XCTAssertEqual(steps, [.retire, .credentials, .media, .data])
        XCTAssertEqual(restarted.records.first?.cleanup, .complete)
        XCTAssertNil(restarted.records.first?.preparation?.receipt)
        XCTAssertNil(ContractURLProtocol.requests().first?.value(forHTTPHeaderField: "Cookie"))
    }

    func testAcknowledgedCleanupFailureResumesOfflineAtFailedStep() async throws {
        ContractURLProtocol.install([prepared(), response("{\"operationId\":\"\(operation)\",\"status\":\"completed\"}")])
        store.clean = { _, step in if step == .media { throw CocoaError(.fileWriteNoPermission) } }
        await store.prepare(account: "a")
        await store.submit(account: "a", code: "123456")
        XCTAssertEqual(store.records.first?.outcome, .completed)
        XCTAssertEqual(store.records.first?.cleanup, .media)
        let restarted = AccountDeletionStore(api: api, session: session, url: directory.appendingPathComponent("deletion.json"))
        var steps: [AccountDeletion.Cleanup] = []
        restarted.clean = { _, step in steps.append(step) }
        ContractURLProtocol.install([])
        await restarted.resume()
        XCTAssertEqual(steps, [.media, .data])
        XCTAssertEqual(restarted.records.first?.cleanup, .complete)
        XCTAssertTrue(ContractURLProtocol.requests().isEmpty)
    }

    func testProofRejectionAllowsCancellationButUnauthorizedRemainsUnknown() async {
        ContractURLProtocol.install([prepared(), response(#"{"message":"Invalid proof"}"#, status: 422)])
        await store.prepare(account: "a")
        await store.submit(account: "a", code: "123456")
        XCTAssertNil(store.records.first?.outcome)
        await store.cancel(account: "a")
        XCTAssertTrue(store.records.isEmpty)
        ContractURLProtocol.install([prepared(), response("{}", status: 401)])
        await store.prepare(account: "a")
        await store.submit(account: "a", code: "123456")
        await store.cancel(account: "a")
        XCTAssertEqual(store.records.first?.outcome, .unknown)
    }

    func testWrongAccountAndCorruptStorageAreRefused() async throws {
        ContractURLProtocol.install([prepared(account: "b")])
        await store.prepare(account: "a")
        XCTAssertNotNil(store.error)
        XCTAssertNil(store.records.first?.preparation)
        let file = directory.appendingPathComponent("deletion.json")
        try Data("broken".utf8).write(to: file)
        let restarted = AccountDeletionStore(api: api, session: session, url: file)
        XCTAssertTrue(restarted.blocked("a"))
        await restarted.prepare(account: "a")
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "broken")
    }

    func testMalformedCompletionCannotAuthorizeCleanup() async throws {
        let file = directory.appendingPathComponent("deletion.json")
        let content = #"[{"accountId":"a","outcome":"completed","cleanup":"retire"}]"#
        try Data(content.utf8).write(to: file)
        let restarted = AccountDeletionStore(api: api, session: session, url: file)
        restarted.clean = { _, _ in XCTFail("Malformed confirmation must not erase data") }
        await restarted.resume()
        XCTAssertTrue(restarted.blocked("a"))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), content)
    }

    func testUnknownSubmissionRequiresServerPreparationBeforeItCanBeCancelled() async {
        ContractURLProtocol.install([prepared(), response("{}", status: 503), response("{}", status: 401)])
        await store.prepare(account: "a")
        await store.submit(account: "a", code: "123456")
        await store.prepare(account: "a")
        XCTAssertEqual(store.records.first?.outcome, .unknown)
        ContractURLProtocol.install([prepared()])
        await store.prepare(account: "a")
        XCTAssertNil(store.error)
        XCTAssertNil(store.records.first?.outcome)
        await store.cancel(account: "a")
        XCTAssertTrue(store.records.isEmpty)
    }

    private func prepared(account: String = "a") -> ContractResponse {
        response("{\"accountId\":\"\(account)\",\"operationId\":\"\(operation)\",\"receipt\":\"\(String(repeating: "r", count: 43))\",\"expiresAt\":\"2030-01-08T00:00:00.000Z\",\"proofExpiresAt\":\"2030-01-01T00:05:00.000Z\"}")
    }

    private func response(_ text: String, status: Int = 200) -> ContractResponse { ContractResponse(status: status, data: Data(text.utf8)) }
}
