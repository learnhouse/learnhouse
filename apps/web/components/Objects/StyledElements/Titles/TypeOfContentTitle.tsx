import Image from 'next/image'
import CollectionsLogo from 'public/svg/collections.svg'
import CoursesLogo from 'public/svg/courses.svg'
import TrailLogo from 'public/svg/trail.svg'

function TypeOfContentTitle(props: { title: string; type: string }) {
  function getLogo() {
    if (props.type == 'col') {
      return CollectionsLogo
    } else if (props.type == 'cou') {
      return CoursesLogo
    } else if (props.type == 'tra') {
      return TrailLogo
    }
  }

  return (
    <div className="home_category_title my-5 flex items-center">
      <div className="my-auto mr-4 ml-2 rounded-full p-2 shadow-inner ring-1 ring-slate-900/5">
        <Image unoptimized className="" src={getLogo()} alt="Courses logo" />
      </div>
      <h1 className="text-2xl font-bold">{props.title}</h1>
    </div>
  )
}

export default TypeOfContentTitle
