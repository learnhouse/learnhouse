# Pester tests for install.ps1 (Windows installer).
#
# The script is dot-sourced with LEARNHOUSE_INSTALL_SOURCE_ONLY=1, which only
# defines Install-LearnHouse. Every external command it uses (docker, node,
# winget, choco, npx.cmd) is replaced by a mock, so these run anywhere pwsh
# runs (Windows, Linux, macOS) and never install anything.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path tests/install.ps1.Tests.ps1 -Output Detailed"

BeforeAll {
    $env:LEARNHOUSE_INSTALL_SOURCE_ONLY = '1'
    . (Join-Path $PSScriptRoot '..' 'install.ps1')

    # Placeholders so the commands exist and can be mocked on any host.
    foreach ($name in 'docker', 'node', 'winget', 'choco', 'npx.cmd') {
        Set-Item -Path "function:global:$name" -Value { $global:LASTEXITCODE = 0 }
    }
    # Anything else the installer might shell out to must not reach the real
    # tool (a real npx would download and run the published CLI).
    foreach ($name in 'npx', 'npm') {
        Set-Item -Path "function:global:$name" -Value { throw "unexpected call to the real '$($MyInvocation.MyCommand.Name)'" }
    }

    # Simulated host state, reset before each test.
    function Reset-Host {
        $script:State = @{
            Docker       = $true   # docker on PATH
            DockerUp     = $true   # `docker info` succeeds
            Node         = 'v24.1.0' # '' = not installed
            NodeAfter    = 'v24.1.0' # version after an install
            Winget       = $true
            Choco        = $false
            WingetCode   = 0
            ChocoCode    = 0
            Npx          = $true
        }
    }

    function Use-HostMocks {
        Mock Get-Command -ParameterFilter { $Name -contains 'winget' } -MockWith { if ($State.Winget) { [pscustomobject]@{ Name = 'winget' } } }
        Mock Get-Command -ParameterFilter { $Name -contains 'choco' } -MockWith { if ($State.Choco) { [pscustomobject]@{ Name = 'choco' } } }
        Mock Get-Command -ParameterFilter { $Name -contains 'docker' } -MockWith { if ($State.Docker) { [pscustomobject]@{ Name = 'docker' } } }
        Mock Get-Command -ParameterFilter { $Name -contains 'node' } -MockWith { if ($State.Node) { [pscustomobject]@{ Name = 'node' } } }
        Mock Get-Command -ParameterFilter { $Name -contains 'npx.cmd' } -MockWith { if ($State.Npx) { [pscustomobject]@{ Name = 'npx.cmd' } } }

        Mock docker {
            if ($args[0] -eq 'info') { $global:LASTEXITCODE = $(if ($State.DockerUp) { 0 } else { 1 }) }
            else { $global:LASTEXITCODE = 0; 'Docker version 27.0.0' }
        }
        Mock node { $global:LASTEXITCODE = 0; $State.Node }
        Mock winget {
            if ($args -contains 'OpenJS.NodeJS.LTS') { $State.Node = $State.NodeAfter }
            $global:LASTEXITCODE = $State.WingetCode
        }
        Mock choco {
            if ($args -contains 'nodejs-lts') { $State.Node = $State.NodeAfter }
            $global:LASTEXITCODE = $State.ChocoCode
        }
        Mock 'npx.cmd' { $global:LASTEXITCODE = 0 }
        Mock Write-Host { }
    }
}

AfterAll {
    Remove-Item Env:LEARNHOUSE_INSTALL_SOURCE_ONLY -ErrorAction SilentlyContinue
    foreach ($name in 'docker', 'node', 'winget', 'choco', 'npx.cmd', 'npx', 'npm') {
        Remove-Item -Path "function:global:$name" -ErrorAction SilentlyContinue
    }
}

Describe 'install.ps1' {
    BeforeEach {
        Reset-Host
        Use-HostMocks
        # Installing Node refreshes $env:Path from the Machine/User registry
        # values, which don't exist off Windows; keep the test session's PATH.
        $script:SavedPath = $env:Path
    }
    AfterEach { $env:Path = $script:SavedPath }

    It 'dot-sourcing only defines Install-LearnHouse (nothing runs)' {
        Test-Path function:Install-LearnHouse | Should -BeTrue
        Should -Invoke winget -Times 0 -Exactly
        Should -Invoke 'npx.cmd' -Times 0 -Exactly
    }

    It 'with Docker and Node 24 ready, launches setup through npx.cmd (not the npx.ps1 shim)' {
        Install-LearnHouse
        Should -Invoke winget -Times 0 -Exactly
        Should -Invoke 'npx.cmd' -Times 1 -Exactly -ParameterFilter { $args -contains 'learnhouse@latest' -and $args -contains 'setup' }
    }

    Context 'Docker' {
        It 'installs Docker Desktop with winget, then stops with next steps instead of continuing' {
            $State.Docker = $false
            Install-LearnHouse
            Should -Invoke winget -Times 1 -Exactly -ParameterFilter { $args -contains 'Docker.DockerDesktop' }
            Should -Invoke 'npx.cmd' -Times 0 -Exactly
            Should -Invoke Write-Host -ParameterFilter { "$Object" -like '*Re-run this installer*' }
        }

        It 'falls back to Chocolatey when winget is missing' {
            $State.Docker = $false; $State.Winget = $false; $State.Choco = $true
            Install-LearnHouse
            Should -Invoke choco -Times 1 -Exactly -ParameterFilter { $args -contains 'docker-desktop' }
        }

        It 'treats winget "already installed" exit codes as success' {
            $State.Docker = $false; $State.WingetCode = -1978335189
            { Install-LearnHouse } | Should -Not -Throw
        }

        It 'fails with a clear message when winget fails' {
            $State.Docker = $false; $State.WingetCode = 1
            { Install-LearnHouse } | Should -Throw '*winget could not install Docker Desktop*'
        }

        It 'fails when neither winget nor Chocolatey is available' {
            $State.Docker = $false; $State.Winget = $false
            { Install-LearnHouse } | Should -Throw '*winget or Chocolatey is required*'
        }

        It 'a stopped Docker daemon is a warning, not a failure' {
            $State.DockerUp = $false
            { Install-LearnHouse } | Should -Not -Throw
            Should -Invoke Write-Host -ParameterFilter { "$Object" -like '*daemon is not running*' }
            Should -Invoke 'npx.cmd' -Times 1 -Exactly
        }
    }

    Context 'Node.js' {
        It 'upgrades Node older than 22 with winget, then continues' {
            $State.Node = 'v20.11.0'
            Install-LearnHouse
            Should -Invoke winget -Times 1 -Exactly -ParameterFilter { $args -contains 'OpenJS.NodeJS.LTS' }
            Should -Invoke 'npx.cmd' -Times 1 -Exactly
        }

        It 'installs Node when it is missing, with Chocolatey when winget is absent' {
            $State.Node = ''; $State.Winget = $false; $State.Choco = $true
            Install-LearnHouse
            Should -Invoke choco -Times 1 -Exactly -ParameterFilter { $args -contains 'nodejs-lts' }
        }

        It 'fails when Node is still older than 22 after installing (stale PATH)' {
            $State.Node = 'v18.0.0'; $State.NodeAfter = 'v18.0.0'
            { Install-LearnHouse } | Should -Throw '*Node.js >=22 is required*'
            Should -Invoke 'npx.cmd' -Times 0 -Exactly
        }

        It 'treats Chocolatey reboot-required (3010) as success' {
            $State.Node = ''; $State.Winget = $false; $State.Choco = $true; $State.ChocoCode = 3010
            { Install-LearnHouse } | Should -Not -Throw
        }
    }

    It 'fails clearly when npx.cmd is missing after Node is installed' {
        $State.Npx = $false
        { Install-LearnHouse } | Should -Throw '*npx not found*'
    }
}

Describe 'install.ps1 file' {
    It 'is plain ASCII (renders on consoles without UTF-8)' {
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '..' 'install.ps1'))
        ($bytes | Where-Object { $_ -gt 127 }).Count | Should -Be 0
    }

    It 'parses without errors' {
        $tokens = $null; $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..' 'install.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
        $errors.Count | Should -Be 0
    }
}
