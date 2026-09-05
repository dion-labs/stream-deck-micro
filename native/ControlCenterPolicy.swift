import Foundation

enum ControlCenterPolicy {
    static func validEndpoint(_ url: URL) -> Bool {
        url.scheme == "http" && url.host == "127.0.0.1" && url.port != nil &&
        (1...65535).contains(url.port!) && url.user == nil && url.password == nil &&
        url.query == nil && url.fragment == nil && (url.path.isEmpty || url.path == "/")
    }
    static func sameOrigin(_ url: URL, _ endpoint: URL) -> Bool {
        url.scheme == endpoint.scheme && url.host == endpoint.host && url.port == endpoint.port &&
        url.user == nil && url.password == nil
    }
}
