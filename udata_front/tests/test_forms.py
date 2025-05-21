from typing import List
from udata_front.forms import ExtendedRegisterForm
from udata_front.tests import GouvFrSettings
from udata_front.tests.frontend import GouvfrFrontTestCase
from unittest.mock import patch

import pytest

class ExtendedRegisterFormTest(GouvfrFrontTestCase):
    settings = GouvFrSettings
    modules: List[str] = []

    @pytest.fixture(autouse=True)
    def setup(self, rmock):
        self.rmock = rmock

    def test_register_form_required_fields(self):
        form = ExtendedRegisterForm.from_json({
            'email': 'a@a.fr',
            'password': 'passpass',
            'password_confirm': 'passpass',
        })
        result = form.validate()
        assert result is False
        assert 'first_name' in form.errors
        assert 'last_name' in form.errors

    def test_register_form_accepts_no_url(self):
        form = ExtendedRegisterForm.from_json({
            'email': 'a@a.fr',
            'password': 'passpass',
            'password_confirm': 'passpass',
            'first_name': 'azeaezr http://dumdum.fr',
            'last_name': 'azeaze https://etalab.studio',
        })
        result = form.validate()
        assert result is False
        assert 'first_name' in form.errors
        assert 'last_name' in form.errors

    @pytest.mark.options(RECAPTCHA_PUBLIC_KEY='test', RECAPTCHA_PRIVATE_KEY='test')
    def test_register_form_invalid_recaptcha(self):
        '''It should return False with an invalid recaptcha.'''
        def fake_validate_recaptcha(self, *args, **kwargs):
            raise ValueError('Invalid reCAPTCHA')
        with patch('flask_wtf.recaptcha.RecaptchaField.validate', fake_validate_recaptcha):
            with pytest.raises(ValueError, match='Invalid reCAPTCHA'):
                form = ExtendedRegisterForm.from_json({
                    'email': 'a@a.fr',
                    'first_name': 'first',
                    'last_name': 'last',
                    'password': 'passpass12A',
                    'password_confirm': 'passpass12A',
                    'g-recaptcha-response': 'invalid'
                })
                form.validate()

    @pytest.mark.options(RECAPTCHA_PUBLIC_KEY='test', RECAPTCHA_PRIVATE_KEY='test')
    def test_register_form_validated(self):
        '''It should return True with a valid recaptcha.'''
        def fake_validate_recaptcha(self, *args, **kwargs):
            return True
        with patch('flask_wtf.recaptcha.RecaptchaField.validate', fake_validate_recaptcha):
            form = ExtendedRegisterForm.from_json({
                'email': 'a@a.fr',
                'first_name': 'first',
                'last_name': 'last',
                'password': 'passpass12A',
                'password_confirm': 'passpass12A',
                'g-recaptcha-response': 'PASSED'
            })
            result = form.validate()
            assert result is True
