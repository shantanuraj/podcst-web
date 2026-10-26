import Foundation
import Observation

struct DeletionPreparation: Codable {
    let accountId: String
    let operationId: String
    var receipt: String?
    let expiresAt: String
    let proofExpiresAt: String

    func validate(account: String, needsReceipt: Bool = true) throws {
        guard accountId == account, UUID(uuidString: operationId) != nil,
              (!needsReceipt && receipt == nil) || receipt?.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let expiry = instant(expiresAt), let proofExpiry = instant(proofExpiresAt), expiry > proofExpiry else { throw DurableStateFailure.protocolViolation }
    }

    func instant(_ value: String) -> Date? { try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value) }
}

struct DeletionOutcome: Decodable {
    enum Status: String, Codable { case pending, completed, unknown }
    let status: Status
    let operationId: String?
}

struct AccountDeletion: Codable, Identifiable {
    enum Cleanup: String, Codable, CaseIterable { case retire, credentials, media, data, complete }
    var id: String { accountId }
    let accountId: String
    var preparation: DeletionPreparation?
    var outcome: DeletionOutcome.Status?
    var cleanup: Cleanup?

    func validate() throws {
        guard !accountId.isEmpty, (outcome == .completed) == (cleanup != nil),
              outcome == nil || preparation != nil else { throw DurableStateFailure.protocolViolation }
        try preparation?.validate(account: accountId, needsReceipt: outcome != .completed)
    }
}

@MainActor
@Observable
final class AccountDeletionStore {
    private(set) var records: [AccountDeletion] = []
    private(set) var busy = false
    private(set) var error: String?
    private var readable = true
    private let url: URL
    private let api: APIClient
    private let session: SessionStore
    var suspend: ((String) async throws -> Void)?
    var clean: ((String, AccountDeletion.Cleanup) async throws -> Void)?

    init(api: APIClient, session: SessionStore, url: URL? = nil) {
        self.api = api
        self.session = session
        self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Podcst/account-deletions.json")
        do {
            if FileManager.default.fileExists(atPath: self.url.path) {
                records = try JSONDecoder().decode([AccountDeletion].self, from: Data(contentsOf: self.url))
                guard Set(records.map(\.accountId)).count == records.count else { throw DurableStateFailure.protocolViolation }
                try records.forEach { try $0.validate() }
            }
        } catch { records = []; readable = false; self.error = "Saved deletion status could not be read. Retained data has been preserved." }
    }

    func blocked(_ account: String) -> Bool { !readable || records.contains { $0.accountId == account } }

    private func save(_ record: AccountDeletion) throws {
        guard readable else { throw DurableStateFailure.storageUnavailable }
        let next = records.filter { $0.accountId != record.accountId } + [record]
        try DurableStateStore.protectedWrite(JSONEncoder().encode(next), url)
        records = next
    }

    private func attempt(_ work: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await session.serializeDeletion(work) }
        catch { self.error = error.localizedDescription }
    }

    func prepare(account: String) async {
        await attempt {
            let existing = records.first { $0.accountId == account }
            guard readable, session.verifiedAccountID == account, existing == nil || (existing?.outcome == .unknown && existing?.cleanup == nil), let suspend else { throw DurableStateFailure.protocolViolation }
            try await suspend(account)
            var record = existing ?? AccountDeletion(accountId: account)
            try save(record)
            let preparation = try await api.prepareDeletion(account: account)
            try preparation.validate(account: account)
            record.preparation = preparation
            record.outcome = nil
            try save(record)
        }
    }

    func cancel(account: String) async {
        await attempt {
            guard readable, let record = records.first(where: { $0.accountId == account }), record.outcome == nil else { throw DurableStateFailure.protocolViolation }
            let next = records.filter { $0.accountId != account }
            try DurableStateStore.protectedWrite(JSONEncoder().encode(next), url)
            records = next
            session.resumeAfterDeletionCancellation(account: account)
        }
    }

    func submit(account: String, code: String) async {
        await attempt {
            guard session.verifiedAccountID == account,
                  var record = records.first(where: { $0.accountId == account }), record.cleanup == nil,
                  record.outcome == nil || record.outcome == .unknown,
                  let preparation = record.preparation,
                  preparation.instant(preparation.proofExpiresAt).map({ $0 > Date() }) == true,
                  code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { throw APIError(statusCode: 400, message: "A valid deletion code for the same account is required.") }
            record.outcome = .unknown
            try save(record)
            do {
                let outcome = try await api.submitDeletion(operation: preparation.operationId, code: code)
                guard outcome.operationId == preparation.operationId, outcome.status != .unknown else { throw DurableStateFailure.protocolViolation }
                try await apply(outcome, to: record)
            } catch let failure as APIError where failure.statusCode == 422 {
                record.outcome = nil
                try save(record)
                throw failure
            }
        }
    }

    func check(account: String) async {
        await attempt {
            guard let record = records.first(where: { $0.accountId == account }) else { return }
            if record.outcome == .completed { try await cleanup(record); return }
            guard record.outcome != nil, let preparation = record.preparation, let receipt = preparation.receipt,
                  preparation.instant(preparation.expiresAt).map({ $0 > Date() }) == true else { return }
            try await apply(api.deletionStatus(receipt: receipt), to: record)
        }
    }

    func resume() async {
        for record in records where record.outcome != nil && record.cleanup != .complete { await check(account: record.accountId) }
    }

    private func apply(_ outcome: DeletionOutcome, to record: AccountDeletion) async throws {
        var next = record
        next.outcome = outcome.status
        if outcome.status == .completed { next.cleanup = .retire; next.preparation?.receipt = nil }
        try save(next)
        if next.cleanup != nil { try await cleanup(next) }
    }

    private func cleanup(_ record: AccountDeletion) async throws {
        guard let clean else { throw DurableStateFailure.storageUnavailable }
        var next = record
        while let step = next.cleanup, step != .complete {
            try await clean(next.accountId, step)
            next.cleanup = AccountDeletion.Cleanup.allCases[AccountDeletion.Cleanup.allCases.firstIndex(of: step)! + 1]
            try save(next)
        }
    }
}
