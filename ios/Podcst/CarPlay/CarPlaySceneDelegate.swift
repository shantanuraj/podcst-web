import CarPlay

@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var controller: CarPlayController?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        let app = AppModel.shared
        let controller = CarPlayController(app: app)
        self.controller = controller
        controller.connect(interfaceController)
        app.setActive(true, for: .carPlay)
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        controller?.disconnect()
        controller = nil
        AppModel.shared.setActive(false, for: .carPlay)
    }
}
