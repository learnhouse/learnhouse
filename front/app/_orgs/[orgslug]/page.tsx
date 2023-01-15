"use client";
import { Title } from "@components/UI/Elements/Styles/Title";
import Link from "next/link";
import { usePathname } from "next/navigation";

const OrgHomePage = (params: any) => {
  const orgslug = params.params.orgslug;
  const pathname = usePathname();

  return (
    <div>
      <Title>Welcome {orgslug} 👋🏻</Title>
      <Link href={pathname + "/courses"}>
        <button>See Courses </button>
      </Link>
    </div>
  );
};

export default OrgHomePage;
