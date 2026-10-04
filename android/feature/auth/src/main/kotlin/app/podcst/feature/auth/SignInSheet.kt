package app.podcst.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import app.podcst.designsystem.ButtonKind
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.Hairline
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstButton
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.PodcstTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInSheet(
    state: SignInState,
    onEmail: (String) -> Unit,
    onCode: (String) -> Unit,
    onPasskey: () -> Unit,
    onSubmit: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = Podcst.colors
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val dismiss = { scope.launch { sheet.hide() }.invokeOnCompletion { onDismiss() } }
    LaunchedEffect(state.signedIn) { if (state.signedIn) dismiss() }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheet,
        containerColor = colors.paper,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        SignInForm(state, onEmail, onCode, onPasskey, onSubmit, onCancel = { dismiss() })
    }
}

@Composable
private fun SignInForm(
    state: SignInState,
    onEmail: (String) -> Unit,
    onCode: (String) -> Unit,
    onPasskey: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
) {
    val colors = Podcst.colors
    val code = remember { FocusRequester() }
    LaunchedEffect(state.codeSent) { if (state.codeSent) code.requestFocus() }
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 24.dp)
            .padding(bottom = 24.dp),
    ) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Box(
                Modifier
                    .minimumInteractiveComponentSize()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(role = Role.Button, onClick = onCancel)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.cancel), style = Podcst.type.callout, color = colors.accent)
            }
        }
        Text(
            stringResource(R.string.sign_in),
            style = Podcst.type.largeTitle,
            color = colors.ink,
            modifier = Modifier.padding(top = 8.dp).semantics { heading() },
        )
        Text(
            stringResource(R.string.sign_in_detail),
            style = Podcst.type.body,
            color = colors.secondary,
            modifier = Modifier.padding(top = 10.dp).widthIn(max = 300.dp),
        )
        PodcstButton(
            stringResource(R.string.use_passkey),
            onPasskey,
            Modifier.fillMaxWidth().padding(top = 32.dp),
            kind = ButtonKind.Ink,
            icon = PodcstIcons.Person,
            height = 56.dp,
            corner = 16.dp,
            enabled = !state.working,
        )
        Text(
            stringResource(R.string.passkey_detail),
            style = Podcst.type.meta,
            color = colors.tertiary,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        )
        Row(
            Modifier.fillMaxWidth().padding(top = 32.dp, bottom = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Hairline(Modifier.weight(1f))
            Eyebrow(stringResource(R.string.or_use_email), color = colors.muted)
            Hairline(Modifier.weight(1f))
        }
        Field(
            state.email,
            onEmail,
            placeholder = stringResource(R.string.email_placeholder),
            keyboard = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Send,
            ),
            autofill = ContentType.EmailAddress,
            onDone = onSubmit,
        )
        if (state.codeSent) {
            Field(
                state.code,
                onCode,
                placeholder = stringResource(R.string.code),
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                autofill = ContentType.SmsOtpCode,
                onDone = onSubmit,
                style = Podcst.type.callout.copy(fontFamily = FontFamily.Monospace, letterSpacing = 0.3.em),
                trailing = stringResource(R.string.code_sent),
                modifier = Modifier.padding(top = 10.dp).focusRequester(code),
            )
        }
        state.error?.let { error ->
            Text(
                error,
                style = Podcst.type.caption,
                color = colors.accent,
                modifier = Modifier.padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        PodcstButton(
            stringResource(if (state.codeSent) R.string.sign_in else R.string.email_code),
            onSubmit,
            Modifier.fillMaxWidth().padding(top = 14.dp),
            kind = ButtonKind.Outline,
            height = 52.dp,
            enabled = state.canSubmit,
        )
    }
}

@Composable
private fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardOptions,
    autofill: ContentType,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    trailing: String? = null,
) {
    val colors = Podcst.colors
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val shape = RoundedCornerShape(14.dp)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().semantics { contentType = autofill },
        textStyle = style.copy(color = colors.ink),
        keyboardOptions = keyboard,
        keyboardActions = KeyboardActions(onAny = { onDone() }),
        singleLine = true,
        interactionSource = interaction,
        cursorBrush = SolidColor(colors.accent),
        decorationBox = { field ->
            Row(
                Modifier
                    .height(52.dp)
                    .clip(shape)
                    .background(colors.surface)
                    .border(1.dp, if (focused) colors.accent else colors.rule, shape)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text(placeholder, style = style, color = colors.muted)
                    field()
                }
                if (trailing != null) Text(trailing, style = Podcst.type.meta, color = colors.tertiary)
            }
        },
    )
}

@Preview
@Composable
private fun SignInPreview() {
    PodcstTheme(dark = true) {
        Box(Modifier.background(Podcst.colors.paper)) {
            SignInForm(SignInState(email = "you@podcst.app", code = "482", codeSent = true), {}, {}, {}, {}, {})
        }
    }
}
