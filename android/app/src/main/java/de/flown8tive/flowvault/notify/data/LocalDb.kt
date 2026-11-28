package de.flown8tive.flowvault.notify.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import de.flown8tive.flowvault.notify.model.ChannelDto
import de.flown8tive.flowvault.notify.model.DiagnosisDto
import de.flown8tive.flowvault.notify.model.FlowVaultJson
import de.flown8tive.flowvault.notify.model.InstanceRefDto
import de.flown8tive.flowvault.notify.model.MessageDto
import de.flown8tive.flowvault.notify.model.MessageMetadataDto
import de.flown8tive.flowvault.notify.model.VersionRefDto
import de.flown8tive.flowvault.notify.model.WorkflowRefDto
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.encodeToString

@Entity(tableName = "channels")
data class ChannelEntity(
    @PrimaryKey val instanceId: Int,
    val name: String,
    val color: String,
    val enabled: Boolean,
    val lastSyncOk: Boolean?,
    val openAlerts: Int,
    val unreadCount: Int,
    val readSeq: Long,
    val mutedUntil: Long?,
    val lastMessageTitle: String?,
    val lastMessageBody: String?,
    val lastMessageKind: String?,
    val lastMessageAt: Long?,
)

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val seq: Long,
    val updatedSeq: Long,
    val instanceId: Int,
    val instanceName: String,
    val instanceColor: String,
    val workflowId: Int?,
    val workflowName: String?,
    val versionId: Int?,
    val versionNumber: Int?,
    val alertId: Int?,
    val kind: String,
    val severity: String,
    val title: String,
    val body: String,
    val groupCount: Int,
    val resolvedBySeq: Long?,
    val unread: Boolean = false,
    val metadataJson: String,
    val diagnosisJson: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
) {
    fun decodedDiagnosis(): DiagnosisDto? =
        diagnosisJson?.let { runCatching { FlowVaultJson.decodeFromString<DiagnosisDto>(it) }.getOrNull() }

    fun toDto(): MessageDto = MessageDto(
        seq = seq,
        updatedSeq = updatedSeq,
        instance = InstanceRefDto(instanceId, instanceName, instanceColor),
        workflow = if (workflowId != null && workflowName != null) WorkflowRefDto(workflowId, workflowName) else null,
        version = if (versionId != null && versionNumber != null) VersionRefDto(versionId, versionNumber) else null,
        alertId = alertId,
        kind = kind,
        severity = severity,
        title = title,
        body = body,
        groupCount = groupCount,
        resolvedBySeq = resolvedBySeq,
        unread = unread,
        metadata = runCatching { FlowVaultJson.decodeFromString<MessageMetadataDto>(metadataJson) }.getOrDefault(MessageMetadataDto()),
        createdAt = createdAt,
        updatedAt = updatedAt,
    )
}

fun MessageDto.toEntity(defaultUnread: Boolean = false): MessageEntity = MessageEntity(
    seq = seq,
    updatedSeq = updatedSeq,
    instanceId = instance.id,
    instanceName = instance.name,
    instanceColor = instance.color,
    workflowId = workflow?.id,
    workflowName = workflow?.name,
    versionId = version?.id,
    versionNumber = version?.number,
    alertId = alertId,
    kind = kind,
    severity = severity,
    title = title,
    body = body,
    groupCount = groupCount,
    resolvedBySeq = resolvedBySeq,
    unread = unread ?: defaultUnread,
    metadataJson = FlowVaultJson.encodeToString(metadata),
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun ChannelDto.toEntity(): ChannelEntity = ChannelEntity(
    instanceId = instanceId,
    name = name,
    color = color,
    enabled = enabled,
    lastSyncOk = lastSyncOk,
    openAlerts = openAlerts,
    unreadCount = unreadCount,
    readSeq = readSeq,
    mutedUntil = mutedUntil,
    lastMessageTitle = lastMessage?.title,
    lastMessageBody = lastMessage?.body,
    lastMessageKind = lastMessage?.kind,
    lastMessageAt = lastMessage?.updatedAt,
)

@Dao
interface NotifyDao {
    @Query("SELECT * FROM channels ORDER BY CASE WHEN openAlerts > 0 THEN 0 WHEN unreadCount > 0 THEN 1 ELSE 2 END, COALESCE(lastMessageAt, 0) DESC, name ASC")
    fun observeChannels(): Flow<List<ChannelEntity>>

    @Query("SELECT * FROM channels ORDER BY CASE WHEN openAlerts > 0 THEN 0 WHEN unreadCount > 0 THEN 1 ELSE 2 END, COALESCE(lastMessageAt, 0) DESC, name ASC")
    suspend fun getAllChannelsSnapshot(): List<ChannelEntity>

    @Query("SELECT * FROM channels WHERE instanceId = :instanceId LIMIT 1")
    suspend fun getChannel(instanceId: Int): ChannelEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertChannels(items: List<ChannelEntity>)

    @Query("DELETE FROM channels WHERE instanceId NOT IN (:activeIds)")
    suspend fun pruneChannels(activeIds: List<Int>)

    @Query("DELETE FROM channels")
    suspend fun clearChannels()

    @Query("UPDATE channels SET unreadCount = 0, readSeq = MAX(readSeq, :readSeq) WHERE instanceId = :instanceId")
    suspend fun markChannelReadRow(instanceId: Int, readSeq: Long)

    @Query("UPDATE messages SET unread = 0 WHERE instanceId = :instanceId AND seq <= :readSeq")
    suspend fun markMessagesReadUpTo(instanceId: Int, readSeq: Long)

    @Query("UPDATE messages SET unread = :unread WHERE seq = :seq")
    suspend fun setMessageUnreadFlag(seq: Long, unread: Boolean)

    @Query("SELECT seq FROM messages WHERE instanceId = :instanceId ORDER BY seq DESC LIMIT 1")
    suspend fun latestSeqInChannel(instanceId: Int): Long?

    @Query("SELECT COUNT(*) FROM messages WHERE instanceId = :instanceId AND unread = 1")
    suspend fun countUnreadInChannel(instanceId: Int): Int

    @Query("UPDATE channels SET unreadCount = :count WHERE instanceId = :instanceId")
    suspend fun setChannelUnreadCount(instanceId: Int, count: Int)

    @Query("UPDATE channels SET unreadCount = 0")
    suspend fun clearAllChannelUnreadCounts()

    @Query("UPDATE messages SET unread = 0 WHERE unread = 1")
    suspend fun markAllMessagesRead()

    @Query("UPDATE channels SET mutedUntil = :mutedUntil WHERE instanceId = :instanceId")
    suspend fun updateChannelMute(instanceId: Int, mutedUntil: Long?)

    @Query("SELECT * FROM messages WHERE instanceId = :instanceId ORDER BY seq ASC")
    fun observeMessagesForInstance(instanceId: Int): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE kind IN ('alert_opened', 'alert_escalated') AND resolvedBySeq IS NULL ORDER BY updatedAt DESC")
    fun observeOpenAlertMessages(): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE kind IN ('alert_opened', 'alert_escalated') AND resolvedBySeq IS NULL ORDER BY updatedAt DESC LIMIT 5")
    suspend fun getOpenAlertsSnapshot(): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE unread = 1 ORDER BY seq DESC")
    fun observeAllUnreadMessages(): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE unread = 1 ORDER BY seq DESC LIMIT 5")
    suspend fun getUnreadMessagesSnapshot(): List<MessageEntity>

    @Query("SELECT * FROM messages ORDER BY seq DESC LIMIT 5")
    suspend fun getRecentMessagesSnapshot(): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE title LIKE :q OR body LIKE :q OR workflowName LIKE :q ORDER BY seq DESC LIMIT 100")
    fun searchMessages(q: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE instanceId = :instanceId ORDER BY seq DESC LIMIT 5")
    suspend fun recentForInstance(instanceId: Int): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE seq = :seq LIMIT 1")
    suspend fun getMessage(seq: Long): MessageEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMessages(items: List<MessageEntity>)

    @Query("UPDATE messages SET diagnosisJson = :diagnosisJson WHERE seq = :seq")
    suspend fun saveDiagnosis(seq: Long, diagnosisJson: String)

    @Query("UPDATE messages SET resolvedBySeq = :resolvedBySeq WHERE alertId = :alertId AND kind IN ('alert_opened', 'alert_escalated') AND resolvedBySeq IS NULL")
    suspend fun markAlertResolved(alertId: Int, resolvedBySeq: Long)

    @Query("DELETE FROM messages")
    suspend fun clearMessages()
}

@Database(entities = [ChannelEntity::class, MessageEntity::class], version = 3, exportSchema = false)
abstract class FlowVaultDatabase : RoomDatabase() {
    abstract fun dao(): NotifyDao

    companion object {
        @Volatile
        private var instance: FlowVaultDatabase? = null

        fun get(context: Context): FlowVaultDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    FlowVaultDatabase::class.java,
                    "flowvault_notify.db",
                ).fallbackToDestructiveMigration().build().also { instance = it }
            }
    }
}
