import SwiftUI

enum AuthPhase {
    case email
    case code
    case success
}

struct AuthView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var phase: AuthPhase = .email
    @State private var isLoading = false
    @State private var errorMessage: String?

    private let apiClient = APIClient(baseURL: Configuration.apiBaseURL)

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 8) {
                Text("Podcst")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Sign in to sync your subscriptions")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 16) {
                switch phase {
                case .email:
                    emailPhase

                case .code:
                    codePhase

                case .success:
                    successPhase
                }
            }
            .padding(.horizontal, 32)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()
            Spacer()
        }
        .navigationTitle("Sign In")
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private var emailPhase: some View {
        TextField("Email", text: $email)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .textFieldStyle(.roundedBorder)

        Button {
            Task { await sendCode() }
        } label: {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else {
                Text("Continue")
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(email.isEmpty || isLoading)
    }

    @ViewBuilder
    private var codePhase: some View {
        Text("Enter the 6-digit code sent to")
            .font(.subheadline)
            .foregroundStyle(.secondary)

        Text(email)
            .font(.subheadline)
            .fontWeight(.medium)

        TextField("Code", text: $code)
            .textContentType(.oneTimeCode)
            .keyboardType(.numberPad)
            .textFieldStyle(.roundedBorder)
            .multilineTextAlignment(.center)

        Button {
            Task { await verifyCode() }
        } label: {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else {
                Text("Verify")
                    .frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .disabled(code.count != 6 || isLoading)

        Button("Change email") {
            phase = .email
            code = ""
            errorMessage = nil
        }
        .font(.caption)
    }

    @ViewBuilder
    private var successPhase: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 64))
            .foregroundStyle(.green)

        Text("You're signed in!")
            .font(.headline)

        Button("Done") {
            dismiss()
        }
        .buttonStyle(.borderedProminent)
    }

    private func sendCode() async {
        isLoading = true
        errorMessage = nil

        do {
            try await apiClient.sendVerificationCode(email: email)
            phase = .code
        } catch {
            errorMessage = "Failed to send code. Please try again."
        }

        isLoading = false
    }

    private func verifyCode() async {
        isLoading = true
        errorMessage = nil

        do {
            let success = try await apiClient.emailLogin(email: email, code: code)
            if success {
                phase = .success
            } else {
                errorMessage = "Invalid code. Please try again."
            }
        } catch {
            errorMessage = "Verification failed. Please try again."
        }

        isLoading = false
    }
}
