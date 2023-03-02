"use client";
import { Title } from "@components/UI/Elements/Styles/Title";
import { getUriWithOrg } from "@services/config";
import Link from "next/link";
import { usePathname } from "next/navigation";

const OrgHomePage = (params: any) => {
  const orgslug = params.params.orgslug;
  const pathname = usePathname();

  return (
    <div>
      <Title>Welcome {orgslug} 👋🏻</Title>
      <Link href={getUriWithOrg(orgslug,"/courses")}>
        <button>See Courses </button>
      </Link>
    </div>
  );
};

export default OrgHomePage;
