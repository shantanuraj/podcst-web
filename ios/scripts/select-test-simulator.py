import json
import os
import subprocess


inventory = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "--json"]))
runtimes = {
    runtime["identifier"]: tuple(map(int, runtime["version"].split(".")))
    for runtime in inventory["runtimes"]
    if runtime["isAvailable"] and runtime["platform"] == "iOS"
}
iphones = {
    device_type["identifier"]
    for device_type in inventory["devicetypes"]
    if device_type["productFamily"] == "iPhone"
}
candidates = [
    (runtimes[runtime], device["udid"], device["name"], runtime)
    for runtime, devices in inventory["devices"].items()
    if runtime in runtimes
    for device in devices
    if device["isAvailable"] and device["deviceTypeIdentifier"] in iphones
]
if not candidates:
    raise SystemExit("No available iPhone simulator")
version, identifier, name, runtime = max(candidates)
if version < (18,):
    raise SystemExit("An iOS 18 or later simulator is required")
with open(os.environ["GITHUB_ENV"], "a") as output:
    output.write(f"PODCST_TEST_DEVICE={identifier}\n")
print(f"Selected {name}: iOS {'.'.join(map(str, version))} ({runtime}), {identifier}")
