from typing import Optional
from pydantic import BaseModel

#### Classes ####################################################


class Organization(BaseModel):
    name: str
    description: str
    email: str
    slug: str
    logo: Optional[str]
    default: Optional[bool] = False


class OrganizationInDB(Organization):
    org_id: str


class PublicOrganization(Organization):
    name: str
    description: str
    email: str
    slug: str
    org_id: str

    def __getitem__(self, item):
        return getattr(self, item)
