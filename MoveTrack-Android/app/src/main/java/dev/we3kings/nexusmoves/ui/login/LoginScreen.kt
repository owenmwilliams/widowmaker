package dev.we3kings.nexusmoves.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.we3kings.nexusmoves.ui.auth.AuthViewModel
import dev.we3kings.nexusmoves.ui.theme.BrandLogo
import dev.we3kings.nexusmoves.ui.theme.nexus
import kotlinx.coroutines.launch

/**
 * Email + 6-digit OTP login — port of iOS LoginView. Two steps: request a code,
 * then verify it. verifyCode persists the session token (in AuthService).
 */
@Composable
fun LoginScreen(vm: AuthViewModel) {
    val c = nexus
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var codeSent by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        BrandLogo()
        Spacer(Modifier.height(10.dp))
        Text("Nexus Moves", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            "Smart Inventory for Your Move",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(40.dp))

        Column(Modifier.fillMaxWidth()) {
            Text("Email Address", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                placeholder = { Text("you@example.com") },
                singleLine = true,
                enabled = !codeSent,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(16.dp))

        if (!codeSent) {
            Button(
                onClick = { scope.launch { if (vm.requestCode(email.trim())) codeSent = true } },
                enabled = email.isNotEmpty() && !vm.isLoading,
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (vm.isLoading) CircularProgressIndicator(color = Color.White, modifier = Modifier.height(22.dp))
                else Text("Email me a code", fontWeight = FontWeight.SemiBold)
            }
        } else {
            Text(
                "Enter the 6-digit code we emailed to $email",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            CodeBoxesField(
                code = code,
                onCodeChange = { code = it },
                onComplete = { scope.launch { vm.verifyCode(email.trim(), code.trim()) } },
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { scope.launch { vm.verifyCode(email.trim(), code.trim()) } },
                enabled = code.length >= 6 && !vm.isLoading,
                colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (vm.isLoading) CircularProgressIndicator(color = Color.White, modifier = Modifier.height(22.dp))
                else Text("Log In", fontWeight = FontWeight.SemiBold)
            }
            TextButton(onClick = {
                codeSent = false
                code = ""
                vm.errorMessage = null
            }) {
                Text("Use a different email / resend code", style = MaterialTheme.typography.bodySmall)
            }
        }

        vm.errorMessage?.let { error ->
            Spacer(Modifier.height(8.dp))
            Text(error, color = c.danger, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.weight(1f))

        Text(
            "We'll email you a 6-digit code to log in.\nNo password needed!",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 40.dp),
        )
    }
}

/**
 * Six single-digit boxes backed by one hidden field — port of iOS
 * CodeBoxesField. A transparent BasicTextField (number pad, OTP autofill) sits
 * over the boxes and captures paste/autofill/typing; the boxes just render.
 */
@Composable
private fun CodeBoxesField(
    code: String,
    onCodeChange: (String) -> Unit,
    onComplete: () -> Unit,
    count: Int = 6,
) {
    val c = nexus
    Box(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            repeat(count) { index ->
                val ch = code.getOrNull(index)?.toString() ?: ""
                val isCurrent = index == code.length
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(56.dp)
                        .background(c.surfaceCard, RoundedCornerShape(14.dp))
                        .border(
                            width = if (isCurrent) 2.dp else 1.dp,
                            color = if (isCurrent) c.accent else c.border,
                            shape = RoundedCornerShape(14.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(ch, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = c.textPrimary)
                }
            }
        }

        BasicTextField(
            value = code,
            onValueChange = { new ->
                val filtered = new.filter { it.isDigit() }.take(count)
                onCodeChange(filtered)
                if (filtered.length == count) onComplete()
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            cursorBrush = SolidColor(Color.Transparent),
            textStyle = TextStyle(color = Color.Transparent),
            modifier = Modifier.matchParentSize(),
        )
    }
}
