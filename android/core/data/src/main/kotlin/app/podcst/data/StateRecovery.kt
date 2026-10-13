package app.podcst.data

import app.podcst.model.StateFollowItem
import app.podcst.model.StateProgressItem
import app.podcst.model.StateSnapshot
import app.podcst.model.StateRevision
import app.podcst.network.PodcstApi

internal data class RecoverySnapshots(
    val progress: List<StateSnapshot<StateProgressItem>>,
    val follows: StateSnapshot<StateFollowItem>,
    val requested: List<Long>,
)

class SyncedVersion internal constructor(
    internal val owner: Scope,
    internal val epoch: Long,
    internal val expected: DurableAccount,
    internal val episodeIds: List<Long>,
)

class StateRecovery(private val api: PodcstApi, private val scopes: Scopes) {
    private val durable = scopes.durable

    internal suspend fun progress(owner: Scope, epoch: Long, ids: List<Long>? = null): StateSnapshot<StateProgressItem> {
        val account = checkNotNull(owner.accountId)
        val expected = durable.account(account)
        val snapshot = api.progressState(ids)
        scopes.withVerifiedAccount(owner, epoch) { }
        if (expected.generation != null && expected.generation != snapshot.generation && !expected.pending) {
            val snapshots = snapshots(expected, ids.orEmpty())
            val recovered = scopes.withVerifiedAccount(owner, epoch) { durable.recover(account, expected, snapshots) }
            val selected = ids ?: recovered.progress.keys.toList()
            return StateSnapshot(1, account, checkNotNull(recovered.generation), StateRevision(recovered.progressRevision.toString()), selected.map { StateProgressItem(app.podcst.model.StateID(it.toString()), recovered.progress[it]) })
        } else scopes.withVerifiedAccount(owner, epoch) { durable.installProgress(account, snapshot, ids, expected.generation) }
        return snapshot
    }

    internal suspend fun follows(owner: Scope, epoch: Long): StateSnapshot<StateFollowItem> {
        val account = checkNotNull(owner.accountId)
        val expected = durable.account(account)
        val snapshot = api.followState()
        scopes.withVerifiedAccount(owner, epoch) { }
        if (expected.generation != null && expected.generation != snapshot.generation && !expected.pending) {
            val snapshots = snapshots(expected)
            scopes.withVerifiedAccount(owner, epoch) { durable.recover(account, expected, snapshots) }
            return snapshots.follows
        }
        scopes.withVerifiedAccount(owner, epoch) { durable.installFollows(account, snapshot, expected.generation) }
        return snapshot
    }

    suspend fun prepare(episodeIds: List<Long> = emptyList()): SyncedVersion? {
        val owner = scopes.current.value
        val account = owner.accountId ?: return null
        val epoch = scopes.epoch
        val expected = durable.account(account)
        if (expected.generation == null || expected.progressBlocked == null && expected.followBlocked == null) return null
        val snapshots = snapshots(expected, episodeIds)
        return scopes.withVerifiedAccount(owner, epoch) {
            check(durable.account(account) == expected) { "Saved changes changed. Review the synced version again." }
            if (snapshots.follows.generation == expected.generation) null else {
                durable.validateRecovery(account, expected, snapshots)
                SyncedVersion(owner, epoch, expected, episodeIds)
            }
        }
    }

    suspend fun useSyncedVersion(choice: SyncedVersion, checkCurrent: () -> Unit = {}): Map<Long, Int> {
        val account = checkNotNull(choice.owner.accountId)
        val snapshots = snapshots(choice.expected, choice.episodeIds)
        return scopes.withVerifiedAccount(choice.owner, choice.epoch) {
            checkCurrent()
            val recovered = durable.recover(account, choice.expected, snapshots, discardPending = true)
            durable.clearError(account)
            recovered.progress.mapValues { it.value?.positionSeconds ?: 0 }
        }
    }

    private suspend fun snapshots(expected: DurableAccount, episodeIds: List<Long> = emptyList()): RecoverySnapshots {
        val ids = (expected.progress.keys + expected.progressOverlay().keys + episodeIds).distinct().sorted()
        val progress = if (ids.isEmpty()) listOf(api.progressState()) else ids.chunked(200).map { api.progressState(it) }
        return RecoverySnapshots(progress, api.followState(), ids)
    }
}
