$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$utf8Encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8Encoding
$OutputEncoding = $utf8Encoding

$script:RepositoryRoot = Split-Path -Parent $PSScriptRoot
$script:InvocationDirectory = (Get-Location).Path
$script:NodeExecutable = $null

function Write-LauncherUsage {
  Write-Host 'ContractGuard V1.1.0 Windows launcher'
  Write-Host ''
  Write-Host 'Usage:'
  Write-Host '  start-contractguard.bat'
  Write-Host '  start-contractguard.bat <llm-config.json>'
  Write-Host '  start-contractguard.bat --config <llm-config.json>'
  Write-Host '  start-contractguard.bat --policy <rule-policy.json>'
  Write-Host '  start-contractguard.bat --check [llm-config.json]'
  Write-Host '  start-contractguard.bat --build [llm-config.json]'
  Write-Host '  start-contractguard.bat --install [llm-config.json]'
  Write-Host '  start-contractguard.bat --no-ai'
  Write-Host '  start-contractguard.bat --help'
  Write-Host ''
  Write-Host 'Options:'
  Write-Host '  --check       Validate runtime, builds and JSON without prompting or starting.'
  Write-Host '  --build       Rebuild all workspaces before starting.'
  Write-Host '  --install     Install the locked dependencies, rebuild, then start.'
  Write-Host '  --config      Select a V1.1 multi-LLM JSON file.'
  Write-Host '  --policy      Select a V1.1 rule-policy JSON file.'
  Write-Host '  --host        Override HOST for this process.'
  Write-Host '  --port        Override PORT for this process.'
  Write-Host '  --no-ai       Start only the deterministic compatibility analyzer.'
  Write-Host '  --no-pause    Do not pause the BAT window after a failure.'
  Write-Host ''
  Write-Host 'Relative paths are resolved from the directory where the launcher is invoked.'
  Write-Host 'When no config is supplied, config\llm-providers.local.json is auto-detected.'
  Write-Host 'The launcher does not load .env files; use process environment variables instead.'
  Write-Host 'For a path containing CMD metacharacters (such as &), set the matching environment'
  Write-Host 'variable or invoke scripts\start-contractguard.ps1 through powershell.exe directly.'
}

function New-LauncherOptions {
  return [PSCustomObject]@{
    CheckOnly = $false
    Build = $false
    Install = $false
    NoAi = $false
    Help = $false
    Config = $null
    Policy = $null
    BindHost = $null
    Port = $null
  }
}

function Read-RequiredArgument {
  param(
    [string[]]$Values,
    [int]$Index,
    [string]$OptionName
  )

  if ($Index + 1 -ge $Values.Count) {
    throw "$OptionName requires a value."
  }
  $value = [string]$Values[$Index + 1]
  if ([string]::IsNullOrWhiteSpace($value) -or $value.StartsWith('-')) {
    throw "$OptionName requires a value."
  }
  return $value
}

function Parse-LauncherArguments {
  param([string[]]$Values)

  $options = New-LauncherOptions
  for ($index = 0; $index -lt $Values.Count; $index += 1) {
    $argument = [string]$Values[$index]
    switch -Regex ($argument) {
      '^(--help|/\?)$' {
        $options.Help = $true
        continue
      }
      '^--check$' {
        $options.CheckOnly = $true
        continue
      }
      '^--build$' {
        $options.Build = $true
        continue
      }
      '^--install$' {
        $options.Install = $true
        $options.Build = $true
        continue
      }
      '^--no-ai$' {
        $options.NoAi = $true
        continue
      }
      '^--no-pause$' {
        continue
      }
      '^--config$' {
        if ($null -ne $options.Config) {
          throw 'The LLM configuration path was provided more than once.'
        }
        $options.Config = Read-RequiredArgument -Values $Values -Index $index -OptionName '--config'
        $index += 1
        continue
      }
      '^--policy$' {
        if ($null -ne $options.Policy) {
          throw '--policy was provided more than once.'
        }
        $options.Policy = Read-RequiredArgument -Values $Values -Index $index -OptionName '--policy'
        $index += 1
        continue
      }
      '^--host$' {
        if ($null -ne $options.BindHost) {
          throw '--host was provided more than once.'
        }
        $options.BindHost = Read-RequiredArgument -Values $Values -Index $index -OptionName '--host'
        $index += 1
        continue
      }
      '^--port$' {
        if ($null -ne $options.Port) {
          throw '--port was provided more than once.'
        }
        $options.Port = Read-RequiredArgument -Values $Values -Index $index -OptionName '--port'
        $index += 1
        continue
      }
      '^-' {
        throw "Unknown option: $argument"
      }
      default {
        if ($null -ne $options.Config) {
          throw 'The LLM configuration path was provided more than once.'
        }
        $options.Config = $argument
      }
    }
  }

  if ($options.NoAi -and $null -ne $options.Config) {
    throw '--no-ai cannot be combined with an LLM configuration path.'
  }
  if ($options.CheckOnly -and ($options.Build -or $options.Install)) {
    throw '--check cannot be combined with --build or --install.'
  }
  return $options
}

function Resolve-LauncherPath {
  param(
    [string]$PathValue,
    [string]$BaseDirectory = $script:InvocationDirectory
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $null
  }
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $BaseDirectory $PathValue))
}

function Get-NonEmptyEnvironmentValue {
  param([string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name, [EnvironmentVariableTarget]::Process)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }
  return $value.Trim()
}

function Set-ProcessEnvironmentValue {
  param(
    [string]$Name,
    [AllowNull()][string]$Value
  )

  [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
}

function Get-BooleanEnvironmentValue {
  param(
    [string]$Name,
    [bool]$DefaultValue
  )

  $value = Get-NonEmptyEnvironmentValue -Name $Name
  if ($null -eq $value) {
    return $DefaultValue
  }
  switch ($value.ToLowerInvariant()) {
    'true' { return $true }
    '1' { return $true }
    'yes' { return $true }
    'on' { return $true }
    'false' { return $false }
    '0' { return $false }
    'no' { return $false }
    'off' { return $false }
    default { throw "$Name must be true or false." }
  }
}

function Assert-NodeRuntime {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeCommand) {
    throw 'Node.js was not found in PATH. Install Node.js 22.13 or newer, then open a new terminal.'
  }
  $script:NodeExecutable = $nodeCommand.Source
  $versionText = (& $script:NodeExecutable -p 'process.versions.node' 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'Node.js could not report its version.'
  }
  try {
    $version = [Version]$versionText
  } catch {
    throw "Unrecognized Node.js version: $versionText"
  }
  if ($version -lt [Version]'22.13.0') {
    throw "ContractGuard requires Node.js 22.13 or newer; found $versionText."
  }
  Write-Host "[ContractGuard] Node.js $versionText"
}

function Invoke-NodeCapture {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $capturedOutput = @(& $script:NodeExecutable @Arguments 2>&1)
    $capturedExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  return [PSCustomObject]@{
    ExitCode = $capturedExitCode
    Output = $capturedOutput
  }
}

function Invoke-Pnpm {
  param([string[]]$CommandArguments)

  $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($null -ne $pnpmCommand) {
    & $pnpmCommand.Source @CommandArguments
  } else {
    $corepackCommand = Get-Command corepack.cmd -ErrorAction SilentlyContinue
    if ($null -eq $corepackCommand) {
      throw 'pnpm was not found. Install pnpm or enable Corepack, then open a new terminal.'
    }
    & $corepackCommand.Source pnpm @CommandArguments
  }
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm failed with exit code $LASTEXITCODE."
  }
}

function Test-InputNewerThanOutput {
  param(
    [string[]]$InputPaths,
    [string]$OutputPath
  )

  $outputItem = Get-Item -LiteralPath $OutputPath
  foreach ($inputPath in $InputPaths) {
    if (Test-Path -LiteralPath $inputPath -PathType Leaf) {
      if ((Get-Item -LiteralPath $inputPath).LastWriteTimeUtc -gt $outputItem.LastWriteTimeUtc) {
        return $true
      }
      continue
    }
    if (Test-Path -LiteralPath $inputPath -PathType Container) {
      $newerItem = Get-ChildItem -LiteralPath $inputPath -Recurse -File | Where-Object {
        $_.Name -notmatch '\.(test|spec)\.[^.]+$' -and
        $_.LastWriteTimeUtc -gt $outputItem.LastWriteTimeUtc
      } | Select-Object -First 1
      if ($null -ne $newerItem) {
        return $true
      }
    }
  }
  return $false
}

function Assert-BuildOutputs {
  $targets = @(
    [PSCustomObject]@{
      Output = 'packages\core\dist\index.js'
      Inputs = @('packages\core\src', 'packages\core\package.json', 'packages\core\tsconfig.json', 'package.json', 'pnpm-lock.yaml')
    },
    [PSCustomObject]@{
      Output = 'apps\api\dist\index.js'
      Inputs = @('apps\api\src', 'apps\api\package.json', 'apps\api\tsconfig.json', 'package.json', 'pnpm-lock.yaml')
    },
    [PSCustomObject]@{
      Output = 'apps\web\dist\index.html'
      Inputs = @(
        'apps\web\src',
        'apps\web\package.json',
        'apps\web\tsconfig.json',
        'apps\web\tsconfig.app.json',
        'apps\web\tsconfig.node.json',
        'apps\web\vite.config.ts',
        'package.json',
        'pnpm-lock.yaml'
      )
    }
  )

  $staleOutputs = @()
  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target.Output -PathType Leaf)) {
      $staleOutputs += $target.Output
      continue
    }
    if (Test-InputNewerThanOutput -InputPaths $target.Inputs -OutputPath $target.Output) {
      $staleOutputs += $target.Output
    }
  }
  if ($staleOutputs.Count -gt 0) {
    throw ('Build output is missing or stale: ' + ($staleOutputs -join ', ') + '. Run start-contractguard.bat --build.')
  }
  Write-Host '[ContractGuard] Core, API and Web build outputs are present and current.'
}

function Resolve-LlmConfigurationPath {
  param([PSCustomObject]$Options)

  if ($Options.NoAi) {
    return $null
  }
  if ($null -ne $Options.Config) {
    return Resolve-LauncherPath -PathValue $Options.Config
  }
  $environmentPath = Get-NonEmptyEnvironmentValue -Name 'CONTRACTGUARD_LLM_CONFIG'
  if ($null -ne $environmentPath) {
    return Resolve-LauncherPath -PathValue $environmentPath -BaseDirectory $script:RepositoryRoot
  }
  $localPath = Join-Path $script:RepositoryRoot 'config\llm-providers.local.json'
  if (Test-Path -LiteralPath $localPath -PathType Leaf) {
    return [System.IO.Path]::GetFullPath($localPath)
  }
  return $null
}

function Resolve-RulePolicyPath {
  param([PSCustomObject]$Options)

  if ($null -ne $Options.Policy) {
    return Resolve-LauncherPath -PathValue $Options.Policy
  }
  $environmentPath = Get-NonEmptyEnvironmentValue -Name 'CONTRACTGUARD_POLICY_CONFIG'
  if ($null -eq $environmentPath) {
    return $null
  }
  return Resolve-LauncherPath -PathValue $environmentPath -BaseDirectory $script:RepositoryRoot
}

function Read-LlmConfigurationSummary {
  param([string]$ConfigurationPath)

  if (-not (Test-Path -LiteralPath $ConfigurationPath -PathType Leaf)) {
    throw "The LLM configuration file does not exist: $ConfigurationPath"
  }
  Write-Host '[ContractGuard] Validating multi-LLM configuration...'
  $validationCode = @'
import { loadAiConfiguration } from './apps/api/dist/ai/config.js';
try {
  const config = loadAiConfiguration(process.argv[1]);
  if (!config) throw new Error('No LLM configuration was loaded.');
  const summary = {
    enabled: config.enabled,
    activeProfile: config.activeProfile,
    allowRequestProfileOverride: config.allowRequestProfileOverride,
    profiles: config.profiles.map((profile) => ({
      id: profile.id,
      enabled: profile.enabled,
      displayName: profile.displayName,
      provider: profile.provider,
      model: profile.model,
      authType: profile.auth.type,
      secretEnv: profile.auth.secretEnv ?? null,
      dataBoundary: profile.dataBoundary
    }))
  };
  console.log('CONTRACTGUARD_CONFIG_JSON:' + JSON.stringify(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
'@
  $validation = Invoke-NodeCapture -Arguments @('--input-type=module', '-e', $validationCode, $ConfigurationPath)
  if ($validation.ExitCode -ne 0) {
    throw ('LLM configuration validation failed: ' + (($validation.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine))
  }
  $markerLine = $validation.Output | ForEach-Object { [string]$_ } | Where-Object {
    $_.StartsWith('CONTRACTGUARD_CONFIG_JSON:')
  } | Select-Object -Last 1
  if ($null -eq $markerLine) {
    throw 'LLM configuration validation did not return a summary.'
  }
  $json = $markerLine.Substring('CONTRACTGUARD_CONFIG_JSON:'.Length)
  $summary = $json | ConvertFrom-Json
  Write-Host ("[ContractGuard] LLM configuration valid: {0} profile(s), active={1}." -f @($summary.profiles).Count, $summary.activeProfile)
  return $summary
}

function Assert-RulePolicy {
  param([string]$PolicyPath)

  if ([string]::IsNullOrWhiteSpace($PolicyPath)) {
    return
  }
  if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
    throw "The rule policy file does not exist: $PolicyPath"
  }
  Write-Host '[ContractGuard] Validating rule policy...'
  $validationCode = @'
import { readFileSync, statSync } from 'node:fs';
import { validateRulePolicy } from './packages/core/dist/index.js';
try {
  const path = process.argv[1];
  if (statSync(path).size > 65536) throw new Error('Rule policy exceeds 65536 bytes.');
  const policy = validateRulePolicy(JSON.parse(readFileSync(path, 'utf8')));
  console.log('CONTRACTGUARD_POLICY_OK:' + (policy.id ?? 'custom-policy'));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
'@
  $validation = Invoke-NodeCapture -Arguments @('--input-type=module', '-e', $validationCode, $PolicyPath)
  if ($validation.ExitCode -ne 0) {
    throw ('Rule policy validation failed: ' + (($validation.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine))
  }
  $markerLine = $validation.Output | ForEach-Object { [string]$_ } | Where-Object {
    $_.StartsWith('CONTRACTGUARD_POLICY_OK:')
  } | Select-Object -Last 1
  if ($null -eq $markerLine) {
    throw 'Rule policy validation did not complete.'
  }
  Write-Host ('[ContractGuard] Rule policy valid: ' + $markerLine.Substring('CONTRACTGUARD_POLICY_OK:'.Length) + '.')
}

function Request-SecretForProfile {
  param([PSCustomObject]$Profile)

  $secretName = [string]$Profile.secretEnv
  if ([string]::IsNullOrWhiteSpace($secretName)) {
    return
  }
  $existingSecret = Get-NonEmptyEnvironmentValue -Name $secretName
  if ($null -ne $existingSecret) {
    Write-Host ("[ContractGuard] {0}: using existing process variable {1}." -f $Profile.displayName, $secretName)
    return
  }

  $secureSecret = $null
  $plainSecret = $null
  try {
    $prompt = "{0} API key (leave empty to keep this profile unavailable)" -f $Profile.displayName
    $secureSecret = Read-Host -Prompt $prompt -AsSecureString
    $plainSecret = [System.Net.NetworkCredential]::new('', $secureSecret).Password
    if ([string]::IsNullOrWhiteSpace($plainSecret)) {
      Write-Warning ("{0} remains unavailable because {1} is empty." -f $Profile.displayName, $secretName)
      return
    }
    Set-ProcessEnvironmentValue -Name $secretName -Value $plainSecret
    Write-Host ("[ContractGuard] {0}: key accepted for this process only." -f $Profile.displayName)
  } finally {
    Remove-Variable plainSecret -ErrorAction SilentlyContinue
    if ($null -ne $secureSecret) {
      $secureSecret.Dispose()
    }
  }
}

function Initialize-MultiLlmEnvironment {
  param(
    [string]$ConfigurationPath,
    [PSCustomObject]$Summary,
    [bool]$AllowPrompt
  )

  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_LLM_CONFIG' -Value $ConfigurationPath
  if (-not [bool]$Summary.enabled) {
    Write-Host '[ContractGuard] AI interpretation is disabled by the selected JSON configuration.'
    return
  }

  $profiles = @($Summary.profiles)
  $activeProfile = $profiles | Where-Object { $_.id -eq $Summary.activeProfile } | Select-Object -First 1
  if ($null -eq $activeProfile) {
    throw 'The validated LLM configuration has no active profile.'
  }
  if (-not [bool]$activeProfile.enabled) {
    throw 'The validated LLM configuration references a disabled active profile.'
  }
  if ($activeProfile.authType -eq 'bearer' -and $AllowPrompt) {
    Request-SecretForProfile -Profile $activeProfile
  }

  $missingProfiles = @($profiles | Where-Object {
    $_.enabled -and $_.authType -eq 'bearer' -and
    $null -eq (Get-NonEmptyEnvironmentValue -Name ([string]$_.secretEnv))
  })
  if ($missingProfiles.Count -gt 0) {
    Write-Warning ('Unavailable enabled profile(s): ' + (($missingProfiles | ForEach-Object {
      "{0} ({1})" -f $_.displayName, $_.secretEnv
    }) -join ', '))
  }
}

function Initialize-LegacyDeepSeekEnvironment {
  param([bool]$AllowPrompt)

  $enabledValue = Get-NonEmptyEnvironmentValue -Name 'CONTRACTGUARD_AI_ENABLED'
  $apiKey = Get-NonEmptyEnvironmentValue -Name 'DEEPSEEK_API_KEY'
  if ($null -eq $enabledValue) {
    $enabled = $null -ne $apiKey
  } else {
    $enabled = Get-BooleanEnvironmentValue -Name 'CONTRACTGUARD_AI_ENABLED' -DefaultValue $false
  }

  if ($enabled -and $null -eq $apiKey -and $AllowPrompt) {
    $profile = [PSCustomObject]@{
      displayName = 'DeepSeek'
      secretEnv = 'DEEPSEEK_API_KEY'
    }
    Request-SecretForProfile -Profile $profile
    $apiKey = Get-NonEmptyEnvironmentValue -Name 'DEEPSEEK_API_KEY'
  } elseif (-not $enabled -and $null -eq $enabledValue -and $null -eq $apiKey -and $AllowPrompt) {
    Write-Host '[ContractGuard] No multi-LLM JSON was selected; using the legacy DeepSeek-compatible startup flow.'
    $profile = [PSCustomObject]@{
      displayName = 'DeepSeek'
      secretEnv = 'DEEPSEEK_API_KEY'
    }
    Request-SecretForProfile -Profile $profile
    $apiKey = Get-NonEmptyEnvironmentValue -Name 'DEEPSEEK_API_KEY'
    $enabled = $null -ne $apiKey
  }

  if ($enabled -and $null -eq $apiKey) {
    Write-Warning 'Legacy AI was enabled but DEEPSEEK_API_KEY is empty; starting with AI interpretation disabled.'
    $enabled = $false
  }
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_ENABLED' -Value $enabled.ToString().ToLowerInvariant()

  $defaults = @{
    DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
    DEEPSEEK_MODEL = 'deepseek-flash'
    CONTRACTGUARD_AI_TIMEOUT_MS = '30000'
    CONTRACTGUARD_AI_MAX_CHANGES = '50'
    CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS = '8192'
    CONTRACTGUARD_AI_MAX_RESPONSE_BYTES = '131072'
  }
  foreach ($entry in $defaults.GetEnumerator()) {
    if ($null -eq (Get-NonEmptyEnvironmentValue -Name $entry.Key)) {
      Set-ProcessEnvironmentValue -Name $entry.Key -Value ([string]$entry.Value)
    }
  }

  if ($enabled) {
    Write-Host '[ContractGuard] Legacy DeepSeek AI interpretation is enabled.'
  } else {
    Write-Host '[ContractGuard] Starting without the optional AI interpreter.'
  }
}

function Initialize-NoAiEnvironment {
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_LLM_CONFIG' -Value $null
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_ENABLED' -Value 'false'
  Set-ProcessEnvironmentValue -Name 'DEEPSEEK_API_KEY' -Value $null
  Set-ProcessEnvironmentValue -Name 'DEEPSEEK_BASE_URL' -Value 'https://api.deepseek.com'
  Set-ProcessEnvironmentValue -Name 'DEEPSEEK_MODEL' -Value 'deepseek-flash'
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_TIMEOUT_MS' -Value '30000'
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_MAX_CHANGES' -Value '50'
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_MAX_OUTPUT_TOKENS' -Value '8192'
  Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_AI_MAX_RESPONSE_BYTES' -Value '131072'
  Write-Host '[ContractGuard] AI is explicitly disabled for this launch.'
}

function Assert-LegacyDeepSeekConfiguration {
  Write-Host '[ContractGuard] Validating legacy DeepSeek environment...'
  $validationCode = @'
import {
  createLegacyDeepSeekConfiguration,
  legacyDeepSeekConfigFromEnvironment
} from './apps/api/dist/ai/config.js';
try {
  const config = createLegacyDeepSeekConfiguration(legacyDeepSeekConfigFromEnvironment(process.env));
  console.log('CONTRACTGUARD_LEGACY_OK:' + config.enabled + ':' + config.activeProfile);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
'@
  $validation = Invoke-NodeCapture -Arguments @('--input-type=module', '-e', $validationCode)
  if ($validation.ExitCode -ne 0) {
    throw ('Legacy DeepSeek configuration validation failed: ' + (($validation.Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine))
  }
  $markerLine = $validation.Output | ForEach-Object { [string]$_ } | Where-Object {
    $_.StartsWith('CONTRACTGUARD_LEGACY_OK:')
  } | Select-Object -Last 1
  if ($null -eq $markerLine) {
    throw 'Legacy DeepSeek configuration validation did not complete.'
  }
  Write-Host '[ContractGuard] Legacy DeepSeek environment is valid.'
}

function Get-BrowserUrl {
  $bindHost = Get-NonEmptyEnvironmentValue -Name 'HOST'
  if ($null -eq $bindHost) {
    $bindHost = '127.0.0.1'
  }
  $portText = Get-NonEmptyEnvironmentValue -Name 'PORT'
  if ($null -eq $portText) {
    $portText = '8080'
  }
  $port = 0
  if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "PORT must be an integer from 1 to 65535; found $portText."
  }

  $displayHost = $bindHost
  if ($bindHost -eq '0.0.0.0' -or $bindHost -eq '::' -or $bindHost -eq '*') {
    $displayHost = 'localhost'
  } elseif ($displayHost.Contains(':') -and -not $displayHost.StartsWith('[')) {
    $displayHost = '[' + $displayHost + ']'
  }
  return "http://${displayHost}:$port"
}

function Invoke-ContractGuardLauncher {
  param([string[]]$LauncherArguments)

  try {
    $options = Parse-LauncherArguments -Values $LauncherArguments
    if ($options.Help) {
      Write-LauncherUsage
      return 0
    }

    Write-Host '[ContractGuard] Checking local runtime...'
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
      throw 'Windows PowerShell 5.1 or newer is required.'
    }
    Set-Location -LiteralPath $script:RepositoryRoot
    Assert-NodeRuntime

    if ($options.Install) {
      Write-Host '[ContractGuard] Installing locked dependencies...'
      Invoke-Pnpm -CommandArguments @('install', '--frozen-lockfile')
    }
    if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) {
      throw 'Dependencies are not installed. Run start-contractguard.bat --install.'
    }
    if ($options.Build) {
      Write-Host '[ContractGuard] Building Core, API and Web...'
      Invoke-Pnpm -CommandArguments @('build')
    }
    Assert-BuildOutputs

    if ($null -ne $options.BindHost) {
      Set-ProcessEnvironmentValue -Name 'HOST' -Value $options.BindHost
    }
    if ($null -ne $options.Port) {
      Set-ProcessEnvironmentValue -Name 'PORT' -Value $options.Port
    }
    $browserUrl = Get-BrowserUrl

    $configurationPath = Resolve-LlmConfigurationPath -Options $options
    $policyPath = Resolve-RulePolicyPath -Options $options
    $configurationSummary = $null
    if ($null -ne $configurationPath) {
      $configurationSummary = Read-LlmConfigurationSummary -ConfigurationPath $configurationPath
    }
    Assert-RulePolicy -PolicyPath $policyPath

    if ($null -ne $policyPath) {
      Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_POLICY_CONFIG' -Value $policyPath
    }

    if ($options.CheckOnly) {
      if ($null -ne $configurationSummary) {
        Initialize-MultiLlmEnvironment -ConfigurationPath $configurationPath -Summary $configurationSummary -AllowPrompt $false
      } elseif ($options.NoAi) {
        Initialize-NoAiEnvironment
        Assert-LegacyDeepSeekConfiguration
      } else {
        Initialize-LegacyDeepSeekEnvironment -AllowPrompt $false
        Assert-LegacyDeepSeekConfiguration
      }
      Write-Host '[ContractGuard] Startup validation passed.'
      Write-Host '[ContractGuard] No server was started and no API credential was requested.'
      return 0
    }

    if ($options.NoAi) {
      Initialize-NoAiEnvironment
      Assert-LegacyDeepSeekConfiguration
    } elseif ($null -ne $configurationSummary) {
      Initialize-MultiLlmEnvironment -ConfigurationPath $configurationPath -Summary $configurationSummary -AllowPrompt $true
    } else {
      Set-ProcessEnvironmentValue -Name 'CONTRACTGUARD_LLM_CONFIG' -Value $null
      Initialize-LegacyDeepSeekEnvironment -AllowPrompt $true
      Assert-LegacyDeepSeekConfiguration
    }

    Write-Host "[ContractGuard] Starting server. Open $browserUrl after it is ready."
    Write-Host '[ContractGuard] Press Ctrl+C to stop.'
    Write-Host ''
    & $script:NodeExecutable 'apps/api/dist/index.js'
    $serverExitCode = $LASTEXITCODE
    if ($serverExitCode -ne 0) {
      Write-Host ''
      Write-Host "[ERROR] ContractGuard exited with code $serverExitCode." -ForegroundColor Red
    }
    return $serverExitCode
  } catch {
    Write-Host ''
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    return 1
  } finally {
    Set-Location -LiteralPath $script:InvocationDirectory
  }
}

function Read-BatchForwardedArguments {
  $countText = Get-NonEmptyEnvironmentValue -Name 'CONTRACTGUARD_LAUNCHER_ARG_COUNT'
  $count = 0
  if ($null -eq $countText -or -not [int]::TryParse($countText, [ref]$count) -or $count -lt 0 -or $count -gt 64) {
    throw 'The BAT launcher supplied an invalid argument count.'
  }
  $forwarded = @()
  for ($index = 0; $index -lt $count; $index += 1) {
    $name = "CONTRACTGUARD_LAUNCHER_ARG_$index"
    $value = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
    if ($null -eq $value) {
      throw "The BAT launcher did not supply argument $index."
    }
    $forwarded += $value
  }
  return $forwarded
}

$launcherArguments = $args
if ($args.Count -eq 1 -and $args[0] -eq '--arguments-from-environment') {
  try {
    $launcherArguments = @(Read-BatchForwardedArguments)
  } catch {
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
  }
}

$launcherExitCode = Invoke-ContractGuardLauncher -LauncherArguments $launcherArguments
exit $launcherExitCode
