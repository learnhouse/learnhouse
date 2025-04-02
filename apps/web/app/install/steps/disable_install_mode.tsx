import { Check, Link } from 'lucide-react'

function DisableInstallMode() {
  return (
    <div className="flex items-center space-x-4 rounded-md bg-green-300 p-4 text-green-950">
      <div>
        <Check size={32} />
      </div>
      <div>
        <p className="text-lg font-bold">
          You have reached the end of the Installation process,{' '}
          <b>
            <i>please don't forget to disable installation mode.</i>
          </b>{' '}
        </p>
        <div className="flex items-center space-x-2">
          <Link size={20} />
          <a
            rel="noreferrer"
            target="_blank"
            className="font-medium text-blue-950"
            href="http://docs.learnhouse.app"
          >
            LearnHouse Docs
          </a>
        </div>
      </div>
    </div>
  )
}

export default DisableInstallMode
