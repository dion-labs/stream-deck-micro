import Foundation
@main struct PolicyTests {
    static func main() {
        let endpoint = URL(string: "http://127.0.0.1:17531")!
        assert(ControlCenterPolicy.validEndpoint(endpoint))
        for value in ["https://example.com:17531", "http://localhost:17531", "http://127.0.0.1", "http://user@127.0.0.1:17531", "http://127.0.0.1:17531/path", "http://127.0.0.1:17531/?token=x", "file:///tmp/dashboard.html"] {
            assert(!ControlCenterPolicy.validEndpoint(URL(string: value)!))
        }
        assert(ControlCenterPolicy.sameOrigin(URL(string: "http://127.0.0.1:17531/api/status")!, endpoint))
        for value in ["http://127.0.0.1:17532/", "https://127.0.0.1:17531/", "http://127.0.0.1.evil.test:17531/", "http://localhost:17531/", "file:///tmp/dashboard.html", "http://user@127.0.0.1:17531/"] {
            assert(!ControlCenterPolicy.sameOrigin(URL(string: value)!, endpoint))
        }
        print("Native endpoint/navigation policy checks passed")
    }
}
