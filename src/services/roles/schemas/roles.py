from typing import List, Literal
from pydantic import BaseModel


# Database Models

class Permission(BaseModel):
    action_create: bool
    action_read: bool
    action_update: bool
    action_delete: bool

    def __getitem__(self, item):
        return getattr(self, item)


class Elements(BaseModel):
    courses: Permission
    users: Permission
    houses: Permission
    collections: Permission
    organizations: Permission
    coursechapters: Permission
    lectures: Permission

    def __getitem__(self, item):
        return getattr(self, item)


class Role(BaseModel):
    name: str
    description: str
    elements : Elements
    org_id: str | Literal["*"]


class RoleInDB(Role):
    role_id: str
    created_at: str
    updated_at: str

