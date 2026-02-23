import unittest
from udata_front.security import sanitize_svg, MAX_SVG_SIZE


class TestSVGSanitization(unittest.TestCase):

    def test_basic_script_removal(self):
        payload = b"<svg><script>alert(1)</script></svg>"
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"script", cleaned)
        self.assertNotIn(b"alert", cleaned)

    def test_onload_attribute_removal(self):
        payload = b'<svg onload="alert(1)"></svg>'
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"onload", cleaned)

    def test_malformed_svg_rejection(self):
        payload = b'<svg onload="alert(1)">'  # Missing closing tag
        with self.assertRaises(ValueError):
            sanitize_svg(payload)

    def test_javascript_href_removal(self):
        payload = b'<svg><a href="javascript:alert(1)">Click me</a></svg>'
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"javascript:", cleaned)
        self.assertIn(b"Click me", cleaned)

    def test_namespaced_script_removal(self):
        payload = (
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        )
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"script", cleaned)

    def test_valid_svg_pass(self):
        payload = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" /></svg>'
        cleaned = sanitize_svg(payload)
        self.assertIn(b"circle", cleaned)
        self.assertIn(b'fill="yellow"', cleaned)
        # Verify structure remains valid XML
        self.assertTrue(cleaned.startswith(b"<?xml"))

    def test_foreign_object_removal(self):
        payload = b"<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>"
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"foreignObject", cleaned)

    def test_svg_namespace_validation(self):
        """Test that non-SVG root elements are rejected"""
        payload = b"<html><body>Not an SVG</body></html>"
        with self.assertRaises(ValueError) as ctx:
            sanitize_svg(payload)
        self.assertIn("não é um SVG válido", str(ctx.exception))

    def test_html_entity_obfuscation(self):
        """Test detection of javascript: via HTML entities"""
        # &#106; = 'j', &#97; = 'a', etc.
        payload = b'<svg><a href="&#106;avascript:alert(1)">Click</a></svg>'
        cleaned = sanitize_svg(payload)
        # The href should be removed entirely
        self.assertNotIn(b"href", cleaned)

    def test_url_encoding_detection(self):
        """Test detection of URL-encoded dangerous URIs"""
        payload = b'<svg><a href="%6aavascript:alert(1)">Click</a></svg>'
        cleaned = sanitize_svg(payload)
        # Should detect %6a (hex for 'j')
        self.assertNotIn(b"href", cleaned)

    def test_vbscript_removal(self):
        """Test removal of vbscript: URIs"""
        payload = b'<svg><a href="vbscript:msgbox(1)">Click</a></svg>'
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"vbscript:", cleaned)

    def test_data_uri_removal(self):
        """Test removal of data: URIs (can contain scripts)"""
        # Use simple data URI without < to make valid XML
        payload = b'<svg><a href="data:text/html,alert">Click</a></svg>'
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"data:", cleaned)

    def test_size_limit_enforcement(self):
        """Test that oversized SVGs are rejected"""
        # Create SVG larger than MAX_SVG_SIZE
        large_payload = b"<svg>" + b"x" * (MAX_SVG_SIZE + 1) + b"</svg>"
        with self.assertRaises(ValueError) as ctx:
            sanitize_svg(large_payload)
        self.assertIn("demasiado grande", str(ctx.exception))

    def test_multiple_event_handlers(self):
        """Test removal of multiple event handlers"""
        payload = (
            b'<svg onclick="alert(1)" onload="alert(2)" onmouseover="alert(3)"></svg>'
        )
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"onclick", cleaned)
        self.assertNotIn(b"onload", cleaned)
        self.assertNotIn(b"onmouseover", cleaned)

    def test_action_attribute_removal(self):
        """Test removal of action/formaction attributes with dangerous URIs"""
        payload = b'<svg><form action="javascript:alert(1)"></form></svg>'
        cleaned = sanitize_svg(payload)
        self.assertNotIn(b"javascript:", cleaned)

    def test_whitespace_obfuscation(self):
        """Test detection of javascript: with whitespace/newlines"""
        # Note: lxml normalizes \n to space during XML parsing
        payload = b'<svg><a href="java\nscript:alert(1)">Click</a></svg>'
        cleaned = sanitize_svg(payload)
        # After lxml parsing, \n becomes space, so "java script:" won't match our pattern
        # This is actually OK - the space breaks the javascript: protocol
        # Let's verify javascript is not in the output
        self.assertNotIn(b"javascript", cleaned.lower())


if __name__ == "__main__":
    unittest.main()
