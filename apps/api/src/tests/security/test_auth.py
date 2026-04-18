import time

import pytest
from unittest.mock import Mock, AsyncMock, patch
from fastapi import HTTPException, Request
from sqlmodel import Session
from src.security.auth import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_current_user,
    non_public_endpoint,
    extract_jwt_from_request,
    Token,
    TokenData,
    JWT_COOKIE_NAME,
)
from src.db.users import User, AnonymousUser, PublicUser
from datetime import datetime, timedelta, timezone
import jwt
from src.security.security import SECRET_KEY, ALGORITHM


class TestAuth:
    """Test cases for auth.py module"""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request object"""
        return Mock(spec=Request)

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session"""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_user(self):
        """Create a mock user object"""
        user = Mock(spec=User)
        user.email = "test@example.com"
        user.password = "hashed_password"
        user.model_dump.return_value = {
            "id": 1,
            "email": "test@example.com",
            "username": "testuser",
            "first_name": "Test",
            "last_name": "User",
            "user_uuid": "user_123"
        }
        return user

    def test_token_model(self):
        """Test Token model"""
        token = Token(access_token="test_token", token_type="bearer")
        assert token.access_token == "test_token"
        assert token.token_type == "bearer"

    def test_token_data_model(self):
        """Test TokenData model"""
        token_data = TokenData(username="test@example.com")
        assert token_data.username == "test@example.com"

    def test_token_data_model_default(self):
        """Test TokenData model with default values"""
        token_data = TokenData()
        assert token_data.username is None

    def test_extract_jwt_from_cookie(self):
        """Test extracting JWT from cookie"""
        mock_request = Mock(spec=Request)
        mock_request.cookies = {JWT_COOKIE_NAME: "test_token"}
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")

        token = extract_jwt_from_request(mock_request)
        assert token == "test_token"

    def test_extract_jwt_from_header(self):
        """Test extracting JWT from Authorization header"""
        mock_request = Mock(spec=Request)
        mock_request.cookies = {}
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="Bearer test_token")

        token = extract_jwt_from_request(mock_request)
        assert token == "test_token"

    def test_extract_jwt_no_token(self):
        """Test extracting JWT when no token present"""
        mock_request = Mock(spec=Request)
        mock_request.cookies = {}
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")

        token = extract_jwt_from_request(mock_request)
        assert token is None

    @pytest.mark.asyncio
    async def test_authenticate_user_success(self, mock_request, mock_db_session, mock_user):
        """Test successful user authentication"""
        with patch('src.security.auth.security_get_user', new_callable=AsyncMock) as mock_get_user, \
             patch('src.security.auth.security_verify_password', return_value=True):
            
            mock_get_user.return_value = mock_user
            
            result = await authenticate_user(
                request=mock_request,
                email="test@example.com",
                password="correct_password",
                db_session=mock_db_session
            )
            
            assert result == mock_user
            mock_get_user.assert_called_once_with(mock_request, mock_db_session, "test@example.com")

    @pytest.mark.asyncio
    async def test_authenticate_user_user_not_found(self, mock_request, mock_db_session):
        """Test authentication when user is not found"""
        with patch('src.security.auth.security_get_user', new_callable=AsyncMock) as mock_get_user:
            mock_get_user.return_value = None
            
            result = await authenticate_user(
                request=mock_request,
                email="nonexistent@example.com",
                password="password",
                db_session=mock_db_session
            )
            
            assert result is False

    @pytest.mark.asyncio
    async def test_authenticate_user_wrong_password(self, mock_request, mock_db_session, mock_user):
        """Test authentication with wrong password"""
        with patch('src.security.auth.security_get_user', new_callable=AsyncMock) as mock_get_user, \
             patch('src.security.auth.security_verify_password', return_value=False):
            
            mock_get_user.return_value = mock_user
            
            result = await authenticate_user(
                request=mock_request,
                email="test@example.com",
                password="wrong_password",
                db_session=mock_db_session
            )
            
            assert result is False

    def test_create_access_token_default_expiry(self):
        """Test access token creation with default expiry"""
        data = {"sub": "test@example.com"}
        token = create_access_token(data)

        # Verify token is created
        assert isinstance(token, str)
        assert len(token) > 0

        # Decode and verify token
        decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert decoded["sub"] == "test@example.com"
        assert "exp" in decoded

    def test_create_access_token_custom_expiry(self):
        """Test access token creation with custom expiry"""
        data = {"sub": "test@example.com"}
        expires_delta = timedelta(hours=2)
        token = create_access_token(data, expires_delta)
        
        # Decode and verify token
        decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert decoded["sub"] == "test@example.com"
        
        # Check that expiry time exists and is in the future
        assert "exp" in decoded
        exp_time = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)
        
        # Verify the token expires in the future
        assert exp_time > now

    @pytest.mark.asyncio
    async def test_get_current_user_authenticated(self, mock_request, mock_db_session, mock_user):
        """Test getting current user when authenticated"""
        # Create a valid token
        token = create_access_token({"sub": "test@example.com"})

        # Set up mock request with token in cookie
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {JWT_COOKIE_NAME: token}
        mock_request.state = Mock()

        with patch('src.security.auth.security_get_user', new_callable=AsyncMock) as mock_get_user:
            mock_get_user.return_value = mock_user

            result = await get_current_user(
                request=mock_request,
                db_session=mock_db_session
            )

            assert isinstance(result, PublicUser)
            mock_get_user.assert_called_once_with(mock_request, mock_db_session, email="test@example.com")

    @pytest.mark.asyncio
    async def test_get_current_user_anonymous(self, mock_request, mock_db_session):
        """Test getting current user when anonymous"""
        # Set up mock request with no token
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {}

        result = await get_current_user(
            request=mock_request,
            db_session=mock_db_session
        )

        assert isinstance(result, AnonymousUser)

    @pytest.mark.asyncio
    async def test_get_current_user_invalid_token(self, mock_request, mock_db_session):
        """Test getting current user when JWT is invalid"""
        # Set up mock request with invalid token
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="Bearer invalid_token")
        mock_request.cookies = {}

        # Invalid token should result in anonymous user (jwt_optional behavior)
        result = await get_current_user(
            request=mock_request,
            db_session=mock_db_session
        )

        assert isinstance(result, AnonymousUser)

    @pytest.mark.asyncio
    async def test_get_current_user_user_not_found(self, mock_request, mock_db_session):
        """Test getting current user when user doesn't exist in database"""
        # Create a valid token
        token = create_access_token({"sub": "nonexistent@example.com"})

        # Set up mock request with token
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {JWT_COOKIE_NAME: token}
        mock_request.state = Mock()

        with patch('src.security.auth.security_get_user', new_callable=AsyncMock) as mock_get_user:
            mock_get_user.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(
                    request=mock_request,
                    db_session=mock_db_session
                )

            assert exc_info.value.status_code == 401
            assert "Could not validate credentials" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_non_public_endpoint_authenticated(self, mock_user):
        """Test non_public_endpoint with authenticated user"""
        # Should not raise any exception
        await non_public_endpoint(mock_user)

    @pytest.mark.asyncio
    async def test_non_public_endpoint_anonymous(self):
        """Test non_public_endpoint with anonymous user"""
        anonymous_user = AnonymousUser()

        with pytest.raises(HTTPException) as exc_info:
            await non_public_endpoint(anonymous_user)

        assert exc_info.value.status_code == 401
        assert "Not authenticated" in exc_info.value.detail

    def test_create_refresh_token(self):
        """Test refresh token creation"""
        data = {"sub": "test@example.com"}
        token = create_refresh_token(data)

        # Verify token is created
        assert isinstance(token, str)
        assert len(token) > 0

        # Decode and verify token
        decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert decoded["sub"] == "test@example.com"
        assert decoded["type"] == "refresh"
        assert "exp" in decoded

    def test_create_refresh_token_custom_expiry(self):
        """Test refresh token creation with custom expiry"""
        data = {"sub": "test@example.com"}
        expires_delta = timedelta(days=7)
        token = create_refresh_token(data, expires_delta)

        # Decode and verify token
        decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert decoded["sub"] == "test@example.com"
        assert decoded["type"] == "refresh"

        # Check that expiry time exists and is in the future
        assert "exp" in decoded
        exp_time = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
        now = datetime.now(timezone.utc)

        # Verify the token expires in the future
        assert exp_time > now

    def test_decode_refresh_token_valid(self):
        """Test decoding a valid refresh token"""
        data = {"sub": "test@example.com"}
        token = create_refresh_token(data)

        payload = decode_refresh_token(token)
        assert payload is not None
        assert payload["sub"] == "test@example.com"
        assert payload["type"] == "refresh"

    def test_decode_refresh_token_invalid(self):
        """Test decoding an invalid refresh token"""
        payload = decode_refresh_token("invalid_token")
        assert payload is None

    def test_decode_refresh_token_access_token_rejected(self):
        """Test that access tokens are rejected by decode_refresh_token"""
        # Create an access token (no "type": "refresh")
        data = {"sub": "test@example.com"}
        access_token = create_access_token(data)

        # Should return None because it's not a refresh token
        payload = decode_refresh_token(access_token)
        assert payload is None

    def test_extract_jwt_ignores_api_tokens(self):
        """Test that extract_jwt_from_request ignores API tokens (lh_ prefix)"""
        mock_request = Mock(spec=Request)
        mock_request.cookies = {}
        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="Bearer lh_test_api_token")

        token = extract_jwt_from_request(mock_request)
        assert token is None

    @pytest.mark.asyncio
    async def test_get_current_user_non_session_purpose_raises_401(self, mock_request, mock_db_session):
        """Token with a non-session purpose is rejected with 401."""
        token = create_access_token({"sub": "test@example.com", "purpose": "password_reset"})

        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {JWT_COOKIE_NAME: token}

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request=mock_request, db_session=mock_db_session)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_get_current_user_stale_token_after_password_change_raises_401(
        self, mock_request, mock_db_session, mock_user
    ):
        """Token issued before password_changed_at is rejected with 401."""
        # Include an explicit iat claim (the library does not add it automatically)
        past_iat = int(time.time()) - 10
        token = create_access_token({"sub": "test@example.com", "iat": past_iat})

        # Set password_changed_at after the token iat (aware datetime)
        mock_user.password_changed_at = datetime.now(timezone.utc)

        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {JWT_COOKIE_NAME: token}
        mock_request.state = Mock()

        with patch("src.security.auth.security_get_user", new_callable=AsyncMock, return_value=mock_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=mock_request, db_session=mock_db_session)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_get_current_user_stale_token_naive_password_changed_at_raises_401(
        self, mock_request, mock_db_session, mock_user
    ):
        """Naive password_changed_at (no tzinfo) is treated as UTC and still rejects stale token."""
        # Include an explicit iat claim set in the past
        past_iat = int(time.time()) - 10
        token = create_access_token({"sub": "test@example.com", "iat": past_iat})

        # Set password_changed_at as a naive datetime after the token iat
        mock_user.password_changed_at = datetime.now()

        mock_request.headers = Mock()
        mock_request.headers.get = Mock(return_value="")
        mock_request.cookies = {JWT_COOKIE_NAME: token}
        mock_request.state = Mock()

        with patch("src.security.auth.security_get_user", new_callable=AsyncMock, return_value=mock_user):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=mock_request, db_session=mock_db_session)

        assert exc_info.value.status_code == 401