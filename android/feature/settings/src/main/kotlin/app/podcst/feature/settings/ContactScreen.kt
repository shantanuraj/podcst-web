package app.podcst.feature.settings

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.podcst.designsystem.Card
import app.podcst.designsystem.Eyebrow
import app.podcst.designsystem.LocalToaster
import app.podcst.designsystem.Podcst
import app.podcst.designsystem.PodcstIcons
import app.podcst.designsystem.R as DesignR

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactScreen(onBack: () -> Unit) {
    val colors = Podcst.colors
    val context = LocalContext.current
    val toaster = LocalToaster.current
    val email = stringResource(R.string.support_email)
    val website = stringResource(R.string.support_url)
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Column(Modifier.fillMaxSize().background(colors.paper).nestedScroll(scroll.nestedScrollConnection)) {
        LargeTopAppBar(
            title = { Text(stringResource(R.string.contact_us)) },
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
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                Text(stringResource(R.string.contact_intro), style = Podcst.type.body, color = colors.secondary)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Eyebrow(stringResource(R.string.developer), Modifier.semantics { heading() })
                    Text(stringResource(R.string.developer_name), style = Podcst.type.callout, color = colors.ink)
                }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Eyebrow(stringResource(R.string.contact_email), Modifier.semantics { heading() })
                        SelectionContainer {
                            Text(email, style = Podcst.type.callout, color = colors.ink)
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = {
                                try {
                                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.fromParts("mailto", email, null)))
                                } catch (_: ActivityNotFoundException) {
                                    toaster.show(context.getString(R.string.email_unavailable), context.getString(R.string.email_unavailable_detail))
                                }
                            }) { Text(stringResource(R.string.email_us)) }
                            TextButton(onClick = {
                                context.getSystemService(ClipboardManager::class.java)
                                    .setPrimaryClip(ClipData.newPlainText(context.getString(R.string.contact_email), email))
                            }) { Text(stringResource(R.string.copy_email)) }
                        }
                    }
                }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Eyebrow(stringResource(R.string.support_website), Modifier.semantics { heading() })
                        SelectionContainer {
                            Text(website.removePrefix("https://").removePrefix("www."), style = Podcst.type.callout, color = colors.ink)
                        }
                        TextButton(contentPadding = PaddingValues(0.dp), onClick = {
                            try {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(website)))
                            } catch (_: ActivityNotFoundException) {
                                toaster.show(context.getString(R.string.browser_unavailable), context.getString(R.string.browser_unavailable_detail))
                            }
                        }) { Text(stringResource(R.string.open_support_website)) }
                    }
                }
            }
        }
    }
}
