#!/bin/bash

# Input: logfilename command
log_cmd() {
	EXIT_STATUS=0
	LOGFILE=$LOG/$1
	shift
	CMDLINE_ORIG="$@"
	CMDBIN=$(echo $CMDLINE_ORIG | awk '{print $1}')
	CMD=$(\which $CMDBIN 2>/dev/null | awk '{print $1}')
	echo "#==[ Command ]======================================#" >> $LOGFILE
	if [ -x "$CMD" ]; then
		CMDLINE=$(echo $CMDLINE_ORIG | sed -e "s!${CMDBIN}!${CMD}!")
		echo "# $CMDLINE" >> $LOGFILE
		echo "$CMDLINE" | bash  >> $LOGFILE 2>&1
		EXIT_STATUS=$?
	else
		echo "# $CMDLINE_ORIG" >> $LOGFILE
		echo "ERROR: Command not found or not executible" >> $LOGFILE
		EXIT_STATUS=1
	fi
	echo >> $LOGFILE
	return $EXIT_STATUS
}

# Input: logfilename logfiles...
conf_files() {
	LOGFILE=$LOG/$1
	shift
	for CONF in $@
	do
		echo "#==[ Configuration File ]===========================#" >> $LOGFILE
		if [ -f $CONF ]; then
			echo "# $CONF" >> $LOGFILE
			cat $CONF | sed -e '/^[[:space:]]*#/d;/^[[:space:]]*;/d;s/\r//g;/^[[:space:]]*$/d' >> $LOGFILE 2>> /dev/null
			echo >> $LOGFILE
		else
			echo "# $CONF - File not found" >> $LOGFILE
		fi
		echo >> $LOGFILE
	done
}

# Input: logfilename lines logfiles...
# If lines = 0, includes the entire log file
log_files() {
	LOGFILE=$LOG/$1
	shift
	LOGLINES=$1
	shift
	for CONF in $@
	do
		BAD_FILE=$(echo "$CONF" | egrep "\.tbz$|\.bz2$|\.gz$|\.zip$$")
		if [ -n "$BAD_FILE" ]; then
			continue
		fi
		echo "#==[ Log File ]=====================================#" >> $LOGFILE
		CONF=$(echo $CONF | sed -e "s/%7B%20%7D%7B%20%7D/ /g")
		if [ -f "$CONF" ]; then
			if [[ $CONF =~ \.xz$ ]]; then
				if [ $LOGLINES -eq 0 ]; then
					echo "# $CONF" >> $LOGFILE
					xzcat "$CONF" | sed -e 's/\r//g' >> $LOGFILE
				else
					echo "# $CONF - Last $LOGLINES Lines" >> $LOGFILE
					xzcat "$CONF" | tail -$LOGLINES | sed -e 's/\r//g' >> $LOGFILE
				fi
			else
				if [ $LOGLINES -eq 0 ]; then
					echo "# $CONF" >> $LOGFILE
					sed -e 's/\r//g' "$CONF" >> $LOGFILE
				else
					echo "# $CONF - Last $LOGLINES Lines" >> $LOGFILE
					tail -$LOGLINES "$CONF" | sed -e 's/\r//g' >> $LOGFILE
				fi
			fi
			echo >> $LOGFILE
		else
			echo "# $CONF - File not found" >> $LOGFILE
		fi
		echo >> $LOGFILE
	done
}

echo "* Generating zypper info dump file..."

SPWD=${PWD}
echo "* Current working dir saved: ${PWD}"

TMP_DIR=$(mktemp -d -t zyppdump_XXXXXXXX)
trap "rm -rf "${TMP_DIR}" & echo '* Temp directory removed: "${TMP_DIR}"'" EXIT

echo "* Temp directory created: ${TMP_DIR}"
cd "${TMP_DIR}"

TSTAMP=$(date '+%Y%m%d_%H%M%S')
DIR_NAME="zyppdump_"$(hostname -s)"_"${TSTAMP}
echo "* Creating directory: ${DIR_NAME}"
mkdir "${DIR_NAME}"
export LOG="${TMP_DIR}/${DIR_NAME}"
cd "${DIR_NAME}"

echo -n "* Generating environment logs... "
log_cmd env.txt 'env'
BEF="basic-environment.txt"
log_cmd $BEF 'date'
log_cmd $BEF 'uname -a'
RELEASE=$(ls -1 /etc/*release)
conf_files $BEF $RELEASE
echo "done"

echo -n "* Generating RPM list..."
log_cmd rpm.txt "rpm -qa --queryformat \"%{NAME}|%{ARCH}|%{VERSION}|%{RELEASE}|%{VENDOR}|%{INSTALLTIME}|%{DISTRIBUTION}\n\""
echo "done"

echo -n "* Copying zypper history log... "
log_files zypper-history.txt 0 /var/log/zypp/history-* /var/log/zypp/history
echo "done"

cd ..

OUT_FILE=$(mktemp -u -p "${SPWD}" -t "${DIR_NAME}_XXXX.tbz")
BN_FILE=$(basename "${OUT_FILE}")
echo -n "* Compressing the result to file: ${BN_FILE} ... "
tar cjf "${OUT_FILE}" "${DIR_NAME}"
echo "done"

echo -n "* Calculating MD5 sum: ${BN_FILE} ... "
MD5_SUM=$(md5sum "${OUT_FILE}" | awk '{print $1}')
echo "done ${MD5_SUM}"
HALF_MD5=$(echo ${MD5_SUM} | grep -Po '[0-9a-f]{16}$')
NEW_FILE=${DIR_NAME}"_"${HALF_MD5}".tbz"
cd "${SPWD}"
echo "* Moving ${BN_FILE} to ${NEW_FILE}"
mv "${OUT_FILE}" "${NEW_FILE}"
