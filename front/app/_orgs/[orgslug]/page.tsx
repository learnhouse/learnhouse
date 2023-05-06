"use client";
import { Title } from "@components/UI/Elements/Styles/Title";
import { getUriWithOrg } from "@services/config/config";
import Link from "next/link";
import { usePathname } from "next/navigation";

const OrgHomePage = (params: any) => {
  const orgslug = params.params.orgslug;
  const pathname = usePathname();

  return (
    <div>
      <Title>Welcome {orgslug} 👋🏻</Title>
      <Link href={getUriWithOrg(orgslug, "/courses")}>
        <button className="rounded-md bg-black antialiased ring-offset-purple-800 p-2 px-5 font text-sm font-bold text-white drop-shadow-lg">See Courses </button>
      </Link>
    </div>
  );
};

export default OrgHomePage;
