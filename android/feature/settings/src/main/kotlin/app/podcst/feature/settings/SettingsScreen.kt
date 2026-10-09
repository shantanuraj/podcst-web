package app.podcst.feature.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.podcst.data.Appearance
import app.podcst.designsystem.Card
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Format
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.OptionSheet
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import app.podcst.designsystem.R as DesignR
import app.podcst.designsystem.speed
import app.podcst.model.AudioOptions
import app.podcst.model.Passkey
import app.podcst.model.PlaybackRules
import app.podcst.model.Region
import app.podcst.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    version: String,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    createPasskey: suspend (String) -> String,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val toaster = LocalToaster.current
    val context = LocalContext.current
    val resources = context.resources
    val resolver = context.contentResolver
    val scope = rememberCoroutineScope()

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is SettingsEvent.Imported -> toaster.show(
                    resources.getQuantityString(R.plurals.imported, event.result.succeeded, event.result.succeeded),
                    event.result.failed.takeIf { it > 0 }?.let { resources.getString(R.string.import_failed, it) },
                )
                is SettingsEvent.Failed -> toaster.show(event.message ?: resources.getString(R.string.failed))
                SettingsEvent.SignedOut -> onBack()
            }
        }
    }

    var importScope by remember { mutableStateOf<(() -> Boolean)?>(null) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val current = importScope
        if (current == null || !current()) {
            toaster.show("Account changed. Select the file again.")
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            val document = withContext(Dispatchers.IO) {
                runCatching { resolver.openInputStream(uri)?.use { app.podcst.model.Opml.read(it) } }.getOrNull()
            }
            if (document == null) toaster.show(resources.getString(R.string.unreadable)) else viewModel.import(document, current)
        }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(OPML_TYPE)) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val document = viewModel.opml()
            val written = withContext(Dispatchers.IO) {
                runCatching { resolver.openOutputStream(uri)?.use { it.write(document.encodeToByteArray()) } }.getOrNull() != null
            }
            toaster.show(resources.getString(if (written) R.string.exported else R.string.failed))
        }
    }
    val exportName = stringResource(R.string.export_name)

    SettingsContent(
        state,
        version,
        onBack = onBack,
        onSignIn = onSignIn,
        onAddPasskey = { viewModel.addPasskey(createPasskey) },
        onRemovePasskey = viewModel::removePasskey,
        onSignOut = viewModel::signOut,
        onAppearance = viewModel::setAppearance,
        onRegion = viewModel::setRegion,
        onSpeed = viewModel::setSpeed,
        onVolumeBoost = viewModel::setVolumeBoost,
        onTrimSilence = viewModel::setTrimSilence,
        onImport = { importScope = viewModel.importScope(); importer.launch(OPML_IMPORT_TYPES) },
        onExport = { exporter.launch(exportName) },
    )
}

private enum class Picker { Region, Speed }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsContent(
    state: SettingsState,
    version: String,
    onBack: () -> Unit,
    onSignIn: () -> Unit,
    onAddPasskey: () -> Unit,
    onRemovePasskey: (String) -> Unit,
    onSignOut: () -> Unit,
    onAppearance: (Appearance) -> Unit,
    onRegion: (Region) -> Unit,
    onSpeed: (Double) -> Unit,
    onVolumeBoost: (Boolean) -> Unit,
    onTrimSilence: (Boolean) -> Unit,
    onImport: () -> Unit,
    onExport: () -> Unit,
) {
    val colors = Podcst.colors
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    var picker by rememberSaveable { mutableStateOf<Picker?>(null) }
    var removing by remember { mutableStateOf<Passkey?>(null) }
    Column(Modifier.fillMaxSize().background(colors.paper).nestedScroll(scroll.nestedScrollConnection)) {
        LargeTopAppBar(
            title = { Text(stringResource(R.string.settings)) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(PodcstIcons.Back, stringResource(DesignR.string.back)) }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = colors.paper,
                scrolledContainerColor = colors.paper,
                navigationIconContentColor = colors.ink,
                titleContentColor = colors.ink,
            ),
            scrollBehavior = scroll,
        )
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            AccountCard(state.user, onSignIn)
            state.user?.let { user ->
                Section(stringResource(R.string.account)) {
                    if (state.passkeys.isEmpty() && user.hasPasskey) {
                        SettingRow(stringResource(R.string.passkey), value = stringResource(R.string.passkey_on))
                    }
                    state.passkeys.forEach { passkey -> PasskeyRow(passkey) { removing = passkey } }
                    SettingRow(stringResource(R.string.add_passkey), onClick = onAddPasskey, action = true)
                    SettingRow(stringResource(R.string.sign_out), onClick = onSignOut, action = true, divider = false)
                }
            }
            Section(stringResource(R.string.appearance)) {
                Segments(state.appearance, onAppearance)
            }
            Section(stringResource(R.string.listening)) {
                SettingRow(stringResource(R.string.chart_region), value = state.region?.displayName, onClick = { picker = Picker.Region })
                SettingRow(stringResource(R.string.default_speed), value = Format.speed(state.audio.speed), onClick = { picker = Picker.Speed })
                SwitchRow(stringResource(R.string.volume_boost), stringResource(R.string.volume_boost_detail), state.audio.effects.volumeBoost, onVolumeBoost)
                SwitchRow(stringResource(R.string.trim_silence), stringResource(R.string.trim_silence_detail), state.audio.effects.trimSilence, onTrimSilence)
                SettingRow(
                    stringResource(R.string.skip),
                    value = stringResource(R.string.skip_value, PlaybackRules.skipBack.inWholeSeconds, PlaybackRules.skipForward.inWholeSeconds),
                    divider = false,
                )
            }
            Section(stringResource(R.string.library)) {
                SettingRow(stringResource(R.string.import_opml), onClick = onImport, enabled = !state.importing, progress = state.importing)
                SettingRow(stringResource(R.string.export_subscriptions), onClick = onExport, enabled = state.subscribed, divider = false)
            }
            Footer(version)
        }
    }
    removing?.let { passkey ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(stringResource(R.string.remove_passkey_title)) },
            text = { Text(stringResource(R.string.remove_passkey_detail)) },
            confirmButton = {
                TextButton(onClick = { removing = null; onRemovePasskey(passkey.id) }) {
                    Text(stringResource(R.string.remove_passkey), color = colors.accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) }
            },
            containerColor = colors.elevated,
        )
    }
    when (picker) {
        Picker.Region -> state.region?.let { region ->
            OptionSheet(stringResource(R.string.chart_region), Region.entries, region, Region::displayName, onRegion) { picker = null }
        }
        Picker.Speed -> OptionSheet(stringResource(R.string.default_speed), PlaybackRules.speeds, state.audio.speed, Format::speed, onSpeed) { picker = null }
        null -> Unit
    }
}

@Composable
private fun AccountCard(user: User?, onSignIn: () -> Unit) {
    val colors = Podcst.colors
    Card(Modifier.fillMaxWidth().padding(top = 8.dp), corner = 16.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (user == null) Modifier.clickable(role = Role.Button, onClick = onSignIn) else Modifier)
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(48.dp).clip(CircleShape).background(colors.accentSubtle), contentAlignment = Alignment.Center) {
                if (user == null) {
                    Icon(PodcstIcons.Person, null, Modifier.size(24.dp), tint = colors.accent)
                } else {
                    Text((user.name ?: user.email).take(1).lowercase(), style = Podcst.type.rank, color = colors.accent)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(user?.email ?: stringResource(R.string.sign_in), style = Podcst.type.label, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    stringResource(
                        when {
                            user == null -> R.string.sign_in_detail
                            user.hasPasskey -> R.string.signed_in_passkey
                            else -> R.string.signed_in_sync
                        },
                    ),
                    style = Podcst.type.meta,
                    color = colors.tertiary,
                )
            }
            if (user == null) Icon(PodcstIcons.ChevronRight, null, Modifier.size(16.dp), tint = colors.muted)
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Eyebrow(title, Modifier.padding(start = 4.dp, top = 22.dp, bottom = 8.dp).semantics { heading() })
    Card(Modifier.fillMaxWidth()) {
        Column { content() }
    }
}

@Composable
private fun SettingRow(
    title: String,
    value: String? = null,
    onClick: (() -> Unit)? = null,
    action: Boolean = false,
    enabled: Boolean = true,
    progress: Boolean = false,
    divider: Boolean = true,
) {
    val colors = Podcst.colors
    Row(
        Modifier
            .fillMaxWidth()
            .then(onClick?.let { Modifier.clickable(enabled = enabled, onClick = it) } ?: Modifier)
            .then(if (divider) Modifier.hairline(colors.rule) else Modifier)
            .graphicsLayer { alpha = if (enabled) 1f else 0.5f }
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(title, style = Podcst.type.body, color = if (action) colors.accent else colors.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (value != null) Text(value, style = Podcst.type.body, color = colors.tertiary, maxLines = 1)
        if (progress) CircularProgressIndicator(Modifier.size(16.dp), color = colors.tertiary, strokeWidth = 2.dp)
        if (onClick != null && !action) Icon(PodcstIcons.ChevronRight, null, Modifier.size(16.dp), tint = colors.muted)
    }
}

@Composable
private fun PasskeyRow(passkey: Passkey, onRemove: () -> Unit) {
    val colors = Podcst.colors
    val added = stringResource(R.string.passkey_added, monthYear.format(passkey.created.local()))
    val used = passkey.lastUsed?.let { last ->
        if (last.local().toLocalDate() == LocalDate.now()) stringResource(R.string.passkey_used_today)
        else stringResource(R.string.passkey_used, dayMonth.format(last.local()))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .hairline(colors.rule)
            .heightIn(min = 56.dp)
            .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(passkey.provider ?: stringResource(R.string.passkey), style = Podcst.type.body, color = colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(added, used).joinToString(" · "), style = Podcst.type.meta, color = colors.secondary)
        }
        TextButton(onClick = onRemove) { Text(stringResource(R.string.remove_passkey), color = colors.tertiary) }
    }
}

private val monthYear = DateTimeFormatter.ofPattern("MMM yyyy")
private val dayMonth = DateTimeFormatter.ofPattern("d MMM")

private fun kotlin.time.Instant.local(): LocalDateTime =
    LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(toEpochMilliseconds()), ZoneId.systemDefault())

@Composable
private fun SwitchRow(title: String, detail: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val colors = Podcst.colors
    Row(
        Modifier
            .fillMaxWidth()
            .toggleable(checked, role = Role.Switch, onValueChange = onChange)
            .hairline(colors.rule)
            .heightIn(min = 48.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = Podcst.type.body, color = colors.ink)
            Text(detail, style = Podcst.type.meta, color = colors.secondary)
        }
        Switch(checked, onCheckedChange = null)
    }
}

@Composable
private fun Segments(selected: Appearance, onSelect: (Appearance) -> Unit) {
    val colors = Podcst.colors
    Row(Modifier.fillMaxWidth().padding(6.dp).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Appearance.entries.forEach { option ->
            val active = option == selected
            Box(
                Modifier
                    .weight(1f)
                    .height(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) colors.ink else Color.Transparent)
                    .selectable(active, role = Role.RadioButton) { onSelect(option) },
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(option.label), style = Podcst.type.label, color = if (active) colors.paper else colors.secondary)
            }
        }
    }
}

@Composable
private fun Footer(version: String) {
    val colors = Podcst.colors
    val url = stringResource(R.string.website_url)
    val text = buildAnnotatedString {
        append(stringResource(R.string.version, version))
        append(" ")
        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = colors.accent)))) {
            append(stringResource(R.string.website))
        }
    }
    Text(
        text,
        style = Podcst.type.meta,
        color = colors.muted,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 22.dp),
    )
}

private fun Modifier.hairline(color: Color): Modifier =
    drawBehind { drawLine(color, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }

private val Appearance.label
    get() = when (this) {
        Appearance.System -> R.string.appearance_system
        Appearance.Light -> R.string.appearance_light
        Appearance.Dark -> R.string.appearance_dark
    }

private const val OPML_TYPE = "text/x-opml"
private val OPML_IMPORT_TYPES = arrayOf(OPML_TYPE, "text/xml", "application/xml", "*/*")

@Preview
@Composable
private fun SettingsPreview() {
    PodcstTheme(dark = true) {
        SettingsContent(
            SettingsState(
                user = User(id = "1", email = "shantanu@podcst.app", hasPasskey = true),
                appearance = Appearance.Dark,
                region = Region.US,
                audio = AudioOptions(speed = 1.25),
                subscribed = true,
            ),
            version = "1.0",
            onBack = {},
            onSignIn = {},
            onAddPasskey = {},
            onRemovePasskey = {},
            onSignOut = {},
            onAppearance = {},
            onRegion = {},
            onSpeed = {},
            onVolumeBoost = {},
            onTrimSilence = {},
            onImport = {},
            onExport = {},
        )
    }
}
