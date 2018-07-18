# zyppmon
ZyPP monitor (monitoring tool for zypper)
It's available in docker hub:
https://hub.docker.com/r/vzhestkov/zyppmon/
It can also be used with MongoDB database as a backend to store systems data:
https://hub.docker.com/r/vzhestkov/mongo/
And sample systems data could be found in data container (it contains MongoDB sample database also):
https://hub.docker.com/r/vzhestkov/zyppmon_sample/

How to run all of these containers manually:
1. Create sample data container:
docker create --name zyppmon_sample vzhestkov/zyppmon_sample
2. Run MongoDB database with the data from previous container:
docker run --rm -d -P --volumes-from zyppmon_sample --name zyppmon_mongo vzhestkov/mongo
3. Run ZyPP monitor container with attaching host system zypper data to the container:
docker run --rm -it -p 8843:8843 --volumes-from zyppmon_sample --link zyppmon_mongo -v /var/log/zypp:/var/log/zypp:ro -v /var/lib/rpm:/var/lib/rpm:ro -v /var/cache/zypp:/var/cache/zypp:ro -v /etc/zypp:/etc/zypp:ro -v /etc/os-release:/etc/os-release:ro -e ZM_MONGODB_ENABLED=1 -e ZM_MONGODB_HOST=zyppmon_mongo -e ZM_AUTH_ORDER="bootstrap mongodb" -e HOST="${HOST}" -e HOSTNAME="${HOSTNAME}" -e HOSTTYPE="${HOSTTYPE}" -e OSTYPE="${OSTYPE}" -e MACHTYPE="${MACHTYPE}" -e CPU="${CPU}" --name zyppmon --hostname "${HOSTNAME}" vzhestkov/zyppmon
You may run this container isolated from host system to prevent usage of host system data:
docker run -it -p 8843:8843 --volumes-from zyppmon_sample --link zyppmon_mongo -e ZM_MONGODB_ENABLED=1 -e ZM_MONGODB_HOST=zyppmon_mongo -e ZM_AUTH_ORDER="bootstrap mongodb" --name zyppmon --hostname "${HOSTNAME}" vzhestkov/zyppmon

The web interface is accessible with https://HOSTNAME:8843/ where HOSTNAME could be localhost if you try to open it from docker host itself or specify the name or IP address of the server if you are trying to access it outside.
The sample container contains user test with password test inside the MongoDB.

# mkzyppdump.sh
mkzyppdump.sh is a shell script to gather information about installed packages and zypper history from the system to be loaded to ZyPP monitor.