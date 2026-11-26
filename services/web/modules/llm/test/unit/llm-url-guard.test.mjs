// overleaf-lab (audit M1): SSRF guard for user-supplied BYO base URLs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicLlmBaseUrl } from '../../app/src/LLMClient.mjs'

const ok = (url) => {
    assert.doesNotThrow(() => assertPublicLlmBaseUrl(url), 'should accept ' + url)
}

const blocked = (url, detail) => {
    assert.throws(
        () => assertPublicLlmBaseUrl(url),
        (err) => {
            assert.equal(err.code, 'llm-bad-url')
            if (detail) assert.match(err.message, new RegExp(detail))
            return true
        },
        'should block ' + url,
    )
}

test('accepts public http(s) endpoints', () => {
    ok('https://chat-ai.academiccloud.de/v1')
    ok('https://api.openai.com/v1')
    ok('http://gpu01.example.com:8080/v1')
    blocked('http://gpu.local:8080/v1', 'loopback/local name')
    ok('https://llama.example.com')
})

test('accepts LAN Ollama ranges (primary self-host use case)', () => {
    ok('http://172.18.0.1:11434/v1')
    ok('http://10.0.0.5:11434/v1')
    ok('http://192.168.1.20:8080')
})

test('blocks loopback and metadata/service ranges', () => {
    blocked('http://127.0.0.1:11434/v1', 'loopback')
    blocked('https://localhost:443/v1', 'loopback/local name')
    blocked('http://0.0.0.0:8080', 'loopback|unspecified')
    blocked('http://169.254.169.254/latest/meta-data', 'cloud metadata')
    blocked('http://[::1]:8080/v1', 'loopback/local name')
})

test('blocks non-http(s) schemes and host-less URLs', () => {
    blocked('file:///etc/passwd', 'only http')
    blocked('gopher://internal:25', 'only http')
    blocked('javascript:alert(1)', 'only http|invalid URL')
    blocked('not a url', 'invalid URL')
})

test('blocks localhost-style names', () => {
    blocked('http://ollama.internal:11434/v1', 'loopback/local name')
    blocked('http://db.lan:5432', 'loopback/local name')
})
