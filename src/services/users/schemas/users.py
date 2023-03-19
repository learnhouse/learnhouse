from typing import Literal
from pydantic import BaseModel


class UserOrganization(BaseModel):
    org_id: str
    org_role: Literal['owner', 'editor', 'member'] 


class User(BaseModel):
    username: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    


class UserWithPassword(User):
    password: str


class UserInDB(User):
    user_id: str
    password: str
    verified: bool | None = False
    disabled: bool | None = False
    orgs: list[UserOrganization] = []
    roles: list[str] = []
    creation_date: str
    update_date: str

    


class PublicUser(User):
    user_id: str
    orgs: list[UserOrganization] = []
    roles: list[str] = []
    creation_date: str
    update_date: str


# Forms ####################################################

class PasswordChangeForm(BaseModel):
    old_password: str
    new_password: str
