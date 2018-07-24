#!/usr/bin/perl

use strict;
use warnings;
use threads;
use threads::shared;
use zypp;
use Date::Parse;
use POSIX qw(strftime);
use Cwd;
use Mojolicious::Lite;
plugin 'Subprocess';
use Mojo::IOLoop;
use Mojo::Upload;
use Mojo::Log;
use Mojo::UserAgent;
use File::Temp qw(tempfile tempdir);
use File::Path qw(rmtree);
use JSON::XS;
use Scalar::Util 'weaken';
use MIME::Base64 qw(decode_base64 encode_base64);
use Digest::MD5 qw(md5_hex);
use Crypt::CBC;
use Data::Dumper;

=head1 NAME

zyppm.pl - Zypper monitor tool by Victor Zhestkov. The tool is monitoring installed packages and the history of changes.

=cut

use utf8;
# Set encoding for all open handles including STDIN/OUT
use open ':encoding(UTF-8)';
# With some perl versions the string abowe causing Segmentation fault on starting a thread. (ex. SLES-12SP3 perl v5.18.2)
#use open ':std';

=head1 CONFIGURATION CONSTANTS

Configuration constants are used to set basic configuration to store the data and to set the format of names for systems files.

=over 4

=item B<UPLOAD_DIR>

Sets the directory to upload files used to import systems information: supportconfigs, zypper dumps, rpm.txt and so on.

Default: "/tmp/upload/"

=item B<SYSTEMS_DIR>

Sets the directory to store systems JSON files.

Default: "systems/"

=item B<SYSTEMS_LIST>

Sets the name of the file to store systems list.

Default: "systems/systems.json"

=item B<SYSTEM_EXTENSION>

System file extansion.

Default: ".json"

=item B<BATCH_TIME_DELTA>

Sets the number of seconds to define as minimum gap between the changes considered as different batches.
The intervals smaller than the value specified considered as one batch.

Default: 600

=item B<MAX_RETURN_ITEMS>

Sets the maximum number of items to be returned with B</packages>, B</history>, B</USID/packages> and B</USID/history> web requests.
Could be overridden with B<mxcnt> parameter for the particular request on your own risk
as it could take much time to be processed with the client.

Default: 1000

=back

=cut
my $zmc;
BEGIN {
	glob $zmc;
	if ( open(my $cfg_fh, '<', "config.json") ) {
		eval {
			$zmc = JSON::XS->new->allow_nonref->decode(join('', <$cfg_fh>));
		};
		if ( $@ ) {
			print("Error: Unable to parse config file.\n");
			exit(1);
		}
		close($cfg_fh);
	}
    $ENV{MOJO_MAX_MESSAGE_SIZE} = 134217728;
};
sub getConfigValue {
	my ($name, $default) = @_;
	return (defined($zmc) && defined($zmc->{$name})) ? $zmc->{$name} : $default;
}
use constant {
	# Configuration constants
	UPLOAD_DIR			=> getConfigValue('UPLOAD_DIR', "upload/"),

	SYSTEMS_DIR			=> getConfigValue('SYSTEMS_DIR', "systems/"),
	SYSTEMS_LIST		=> getConfigValue('SYSTEMS_LIST', "systems/systems.json"),
	
	SYSTEM_EXTENSION	=> ".json",

	AUTHKEY_ALIVE		=> 5,
	AUTHKEY_INTERVAL	=> 10,

	AUTH_ORDER			=> getConfigValue('AUTH_ORDER', "none"),
	AUTH_PTOKEN			=> getConfigValue('AUTH_PTOKEN', ""),
	BOOTSTRAP_LOGIN		=> getConfigValue('BOOTSTRAP_LOGIN', ""),
	BOOTSTRAP_PASSWD	=> getConfigValue('BOOTSTRAP_PASSWD', ""),
	MONGODB_ENABLED		=> getConfigValue('MONGODB_ENABLED', 0),
	MONGODB_HOST		=> 'mongodb://'.getConfigValue('MONGODB_USER', "zyppmon").':'.getConfigValue('MONGODB_PASSWORD', "zyppmon").'@'.
							getConfigValue('MONGODB_HOST', "localhost").'/'.getConfigValue('MONGODB_AUTHDB', "zyppmon"),
	MONGODB_DB			=> getConfigValue('MONGODB_DB', "zyppmon"),
	MONGODB_SYSTEMS		=> getConfigValue('MONGODB_SYSTEMS', "systems"),
	MONGODB_SYSDATA		=> getConfigValue('MONGODB_SYSDATA', "sysdata"),
	MONGODB_CMPDATA		=> getConfigValue('MONGODB_CMPDATA', "cmpdata"),

	LISTEN_PORT			=> getConfigValue('LISTEN_PORT', 8880),
	FORCE_SECURE		=> getConfigValue('FORCE_SECURE', 0),
	LISTEN_SECURE		=> getConfigValue('LISTEN_SECURE', 0),
	LISTEN_SECURE_PORT	=> getConfigValue('LISTEN_SECURE_PORT', 8843),
	SECURE_CERT			=> getConfigValue('SECURE_CERT', "zyppmon.cert.pem"),
	SECURE_KEY			=> getConfigValue('SECURE_KEY', "zyppmon.key.pem"),
	
	CACHE_TTL			=> 300,

	BATCH_TIME_DELTA	=> 600,
	
	MAX_RETURN_ITEMS	=> 1000,

	INACTIVITY_TIMEOUT	=> 80,
	# /Configuration constants

	# Internal constants
	ZDFLAG_INSTALLED	=> 1,
	ZDFLAG_HISTORY		=> 2,
	ZDFLAG_UPDATE		=> 5,
	ZDFLAG_SETREPO		=> 8,

	RLP_UNKNOWN			=> 0,
	RLP_SR_QUERY		=> 1,
	RLP_QA_LAST			=> 2,
	RLP_SR_VERIFY		=> 3,
	RLP_QUERY_CUSTOM	=> 4,
	RLP_SKIP			=> 99,

	INF_UNKNOWN			=> 0,
	INF_OSINFO			=> 1,
	INF_ENV				=> 2,
	INF_SKIP			=> 99,
	
	HIST_READ			=> 0,
	HIST_TAIL			=> 1,
	HIST_DONE			=> 2,
	HIST_STOP			=> 4,
	HIST_UPREPOS		=> 8,
	# /Internal constants
};

if ( MONGODB_ENABLED ) {
	eval {
		use MongoDB;
	};
	die $@ if $@;
}

my $cache = {};

# This hash is related to fixing non-English date strings
my %to_en = (
# Russian monthes
	'Янв' => 'Jan', 'Фев' => 'Feb', 'Мар' => 'Mar',
	'Апр' => 'Apr', 'Май' => 'May', 'Июн' => 'Jun',
	'Июл' => 'Jul', 'Авг' => 'Aug', 'Сен' => 'Sep',
	'Окт' => 'Oct', 'Ноя' => 'Nov', 'Дек' => 'Dec',
# Russian days of week
	'Пнд' => 'Mon', 'Пн' => 'Mon',
	'Втр' => 'Tue', 'Вт' => 'Tue',
	'Срд' => 'Wed', 'Ср' => 'Wed',
	'Чтв' => 'Thu', 'Чт' => 'Thu',
	'Птн' => 'Fri', 'Пт' => 'Fri',
	'Сбт' => 'Sat', 'Сб' => 'Sat',
	'Вск' => 'Sun', 'Вс' => 'Sun',
);
# Building regexp pattern to search substrings to fix
my $to_en_rx = join("|", map {quotemeta} keys %to_en);

my @env_v = qw/HOST HOSTNAME HOSTTYPE OSTYPE MACHTYPE CPU/;

# Redefine Mojolicious log output function to change the time format
{
	no warnings 'redefine';
	*Mojo::Log::_default = sub {
		return '' if $_[2] eq 'Routing to a callback';
		'[' . strftime("%Y-%m-%d %T", localtime(shift)) . '] [' . shift() . '] ' . join "\n", @_, '';
	};
}

app->secrets(['ZyppMonSecretPhrase']);

app->log->info("Starting Zypper Monitor");

# Set root directory to look static files from
#app->static->paths->[0] = getcwd().'/zwebapp/';
app->static->paths->[0] = '/zyppmon/webapp/';

my $tthread;

=head1 SHARED GLOBALS

=over 4

=item B<%pkgs>

B<%pkgs> shared hash is a main data structure the tool using to store packages and the history of packages operations.

=cut
my %pkgs: shared;

=item B<@packages>

B<@packages> shared array contains plain list of packages extracted from B<%pkgs>.

=cut
my @packages: shared;

=item B<@history>

B<@history> shared array contains plain list of packages history operations extracted from B<%pkgs>.

=cut
my @history: shared;

=item B<%repos>

B<%repos> shared hash contains a list of system repositories.

=cut
my %repos: shared;

=item B<@systems>

B<@systems> shared array contains plain list of systems stored in JSON file defined by B<SYSTEMS_LIST> global constant.

=cut
my @systems: shared;
my $ext_systems;

=item B<$self_usid>

B<@systems> shared scalar contains the USID of running system.
It's usually autogenerated on first run and stored in JSON file defined by B<SYSTEMS_LIST> global constant.

=cut
my $self_usid: shared;

=item B<$history_ctrl>

B<$history_ctrl> shared scalar is used to control the thread reading zypper history log file.

=cut
my $history_ctrl: shared = 0;

=item B<%state>

B<$history_ctrl> shared hash contains the state variables of current system available with B</check> web service call.

=cut
my %state: shared = ("history-last-id" => 0,
					"history-count" => 0,
					"history-rm" => 0,
					"history-rf" => 0,
					"history-up" => 0,
					"history-dn" => 0,
					"history-in" => 0,
					"systems-ts" => 0,
					"count" => 0,
					"installed" => 0,
					"removed" => 0);

=back

=cut

#my ($mongo, $mongo_db, $mongo_systems, $mongo_sysdata);

app->log->debug("Initializing Zypper instance");

# Initializing zypper instance
my $zypp_factory = zyppc::ZYppFactory_instance();
my $zypp = $zypp_factory->getZYpp();
$zypp->initializeTarget(zypp::Pathname::new("/"));
app->log->debug("Cleaning cache and loading data...");
$zypp->target->cleanCache();
$zypp->target->load();
app->log->debug("... done");

=head1 FUNCTIONS

=over 4

=item B<vrcmp>

The function to compare versions/release or version-release of the package
2 or 4 arguments could be accepted:

=over 5

"VERSION1", "VERSION2"

"RELEASE1", "RELEASE2"

"VERSION1-RELEASE1", "VERSION2-RELEASE2"

"VERSION1", "RELEASE1", "VERSION2", "RELEASE2"

=back

=cut
sub vrcmp {
	my $q = [];
	# Internal function to enqueue the components to compare to LIFO queue
	sub enque_cmp {
		my $q = shift;
		while ( my $p = shift ) {
			$p->[0] = '' unless defined($p->[0]);
			$p->[1] = '' unless defined($p->[1]);
			unshift(@$q, $p) if $p->[0] ne $p->[1];
		}
	}
	# Put the function arguments to the queue to be processed
	if ( @_ == 2 ) {
		enque_cmp($q, [$_[0], $_[1]]);
	} elsif ( @_ == 4 ) {
		enque_cmp($q, [$_[1], $_[3]], [$_[0], $_[2]]);
	} else {
		return undef;
	}
	my $c = 0;
	# Processing the LIFO queue
	while( my $next = shift @$q ) {
		$c++;
		my ($a, $b) = @$next;
		my ($ax, $ay, $bx, $by);
		if ( (($ax, $ay) = $a =~ /\A([^\-]+)(?:\-(.*)|)\z/) &&
				(($bx, $by) = $b =~ /\A([^\-]+)(?:\-(.*)|)\z/) && (defined($ay) || defined($by)) ) {
			# Splitting VERSION-RELEASE stings
			enque_cmp($q, [$ay, $by], [$ax, $bx]);
		} elsif ( (($ax, $ay) = $a =~ /\A([^\.]+)(?:\.(.*)|)/) &&
				(($bx, $by) = $b =~ /\A([^\.]+)(?:\.(.*)|)/) && (defined($ay) || defined($by)) ) {
			# Splitting stings to before '.' component and everything after
			enque_cmp($q, [$ay, $by], [$ax, $bx]);
		} elsif ( $a =~ /\A\d+\z/ && $b =~ /\A\d+\z/ ) {
			# Continue if numeric components are equal or return the result based on comparison of these components
			next if $a == $b;
			return $a > $b ? 1 : -1;
		} elsif ( $a =~ /\A\D+\z/ && $b =~ /\A\D+\z/ ) {
			# Continue if NON numeric components are equal or return the result based on comparison of these components
			next if $a eq $b;
			return $a gt $b ? 1 : -1;
		} elsif ( (($ax, $ay) = $a =~ /\A(\d+)(.*)/) && (($bx, $by) = $b =~ /\A(\d+)(.*)/) ) {
			# Splitting components to numeric and NON numeric parts
			if ($ay ne '' && $by ne '') {
				# Enqueue if NON numeric parts are not blank
				enque_cmp($q, [$ay, $by], [$ax, $bx]);
			} elsif ( $ax != $bx ) {
				# Return the result based on comparison of numeric parts
				return $ax > $bx ? 1 : -1;
			} else {
				# Return the result that the version-release componen with blank value is less than the other
				return $ay eq '' ? -1 : 1;
			}
		} elsif ( (($ax, $ay) = $a =~ /\A(\D+)(.*)/) && (($bx, $by) = $b =~ /\A(\D+)(.*)/) ) {
			# Splitting components to NON numeric and everything last parts
			enque_cmp($q, [$ay, $by], [$ax, $bx]);
		} elsif ( ((($ax, $ay) = $a =~ /\A(\d+)(.*)/) && (($bx, $by) = $b =~ /\A(\D+)(.*)/)) ||
				((($ax, $ay) = $a =~ /\A(\D+)(.*)/) && (($bx, $by) = $b =~ /\A(\d+)(.*)/))) {
			# Processing the situation if one component starts with numeric symbol while the other with NON numeric
			# The component with numeric symbol at start wins. Not sure if it right, but zypper return the same result in such condition
			return $ax =~ /\A\d/ ? 1 : -1;
		} elsif ( $a eq '' || $b eq '' ) {
			# Compare blank an non blank components. Non blank wins
			return $a eq '' ? -1 : 1;
		} else {
			# It shouldn't happen in real life, but...
			return $a gt $b ? 1 : -1;
		}
	}
	return 0;
}

=item B<getvr>

The function splits VERSION and RELEASE components from the string.

Argument: "VERSION-RELEASE" string

Returns: array of 2 elements: ("VERSION" string, "RELEASE" string)

=cut
sub getvr {
	my $s = shift;
	if ( my @r = $s =~ /\A([^\-]+)\-(.*)\z/ ) {
		return @r;
	}
	return undef;
}

=item B<splitNameVerRelArch>

The function splits NAME, VERSION, RELEASE and ARCH components from the string and returns an hash reference.

Argument: "VERSION-RELEASE.ARCH" string, ARCH could be omited

Returns: hash reference: {name => NAME, ver => VERSION, rel => RELEASE, arch => ARCH}

=cut
sub splitNameVerRelArch {
	my ($s) = @_;
	my ($ver, $rel, $arch);
	($s, $arch) = ($1, $2) if ( $s =~ /(.*)\.(noarch|x86_64|i[3-6]86|aarch64)$/ );
	($s, $ver, $rel) = ($1, $2, $3) if ( $s =~ /(?:(.*)\-|)([\w\.\+~]+)\-([\w\.\+]+)/ );
	return {name => $s, ver => $ver, rel => $rel, arch => $arch};
}

=item B<getLimitedArray>

The function returns the array reference to the array made with limited amount of the source items from first argument array reference.

Arguments:

=over 5

=item 1: array reference

The source of the data to return. If this argument is not an array reference it will be returned immidiately as return value.

=item 2: integer

The starting index of the element.
If not specified, the 0 is used.

=item 3: integer

The maximum amount of the elements to be returned.
If not specified, B<MAX_RETURN_ITEMS> configuration constant is used.

=back

Return: hash reference - data item contains the array from 1st argument starting from 2nd argument or 0 if not set
and limited by count specified in 3rd argument or B<MAX_RETURN_ITEMS> if 3rd argument is not defined.
ctrl item of the hash contains the control information.

=cut
sub getLimitedArray {
	my $r = shift;
	my ($st, $mx) = @_;
	if ( ref($r) ne 'ARRAY' ) {
		return $r;
	}
	my @a;
	$st = defined($st) ? int($st) : 0;
	$mx = defined($mx) ? int($mx) : MAX_RETURN_ITEMS;
	my $c = 0;
	my $i = $st;
	my $sz = scalar(@{$r});
	while ( $i < $sz ) {
		my %h = %{$r->[$i]};
		push(@a, \%h);
		$c++;
		$i++;
		if ( $c >= $mx ) {
			last;
		}
	}
	my $ret = {size => $sz, start => $st, items => $c, 'maxReturn' => $mx};
	if ( $i < $sz || $c < $sz ) {
		$ret->{'next'} = $i if ($sz - $i >= 1);
	}
	return {ctrl => $ret, data => \@a};
}

=item B<updateHistoryArray>

The function to update global B<@history> shared array if second argument is not specified
or b<history> section of second argument hash reference.

Arguments:

=over 5

=item 1: integer

Last insert ID value to get only records with History ID larger than this value.

=item 2: hash reference

The reference to the system structure with B<pkgs> and B<history> sections. If not specified global B<%pkgs> and B<@history> are used.

=back

The function returns nothing.

=cut
sub updateHistoryArray {
	my ($lid, $ref) = @_;
	my $p = \%pkgs;
	my $h = \@history;
	my $to_ref = defined($ref);
	$lid = defined($lid) ? $lid : 0;
	if ( $to_ref ) {
		$p = $ref->{pkgs};
		$h = $ref->{history};
	} else {
		lock(@history);
	}
	@$h = () if ( $lid == 0 );
	app->log->debug("Updating history array (".$lid.")...") if $to_ref;
	my $tstamp = time();
	foreach my $arch ( keys(%{$p}) ) {
		foreach my $name ( keys(%{$p->{$arch}}) ) {
			if (defined($p->{$arch}{$name}{h})) {
				my ($ver, $rel, $op, $ts);
				foreach my $hrow ( @{$p->{$arch}{$name}{h}} ) {
					if ( $lid == 0 || $hrow->{hid} > $lid ) {
						my ($preVer, $preRel);
						($preVer, $preRel) = ($ver, $rel) if ( $hrow->{op} =~ /\A(?:up|dn)\z/ );
						my %hr = %{$hrow};
						$hr{name} = $name;
						$hr{arch} = $arch;
						$hr{preVer} = $preVer if defined($preVer);
						$hr{preRel} = $preRel if defined($preRel);
						$hrow->{ts} = $tstamp unless defined($hrow->{ts});
						$hr{ts} = $hrow->{ts};
						push(@$h, $to_ref ? \%hr : shared_clone(\%hr));
					}
					($ver, $rel, $op, $ts) = ($hrow->{ver}, $hrow->{rel}, $hrow->{op}, $hrow->{ts});
					$state{"history-last-id"} = $hrow->{hid} if ( $to_ref && $hrow->{hid} > $state{"history-last-id"} );
				}
			}
		}
	}
	@history = sort({$a->{hid} <=> $b->{hid}} @history);
	app->log->debug("... done #".scalar(@history)) if $to_ref;
}

=item B<s2time>

The function converts string to unix timestamp

Argument: string - time in text format

Return: integer - unix timestamp

=cut
sub s2time {
	my ($t) = @_;
	$t =~ s/(?:\b($to_en_rx)\b)/$to_en{$1}/ig;
	return str2time($t);
}

sub randString { join'', @_[ map { rand @_ } 1 .. shift ] }

=item B<genUSID>

The function generates USID based on system's data.

Arguments:

=over 5

=item 1: hash ref

Hash reference to the system.
=back

Return: string - USID generated based on the system's data specified.

=cut
sub genUSID {
	my ($sys) = @_;
	my $in;
	if ( defined($sys) && $sys->{type} eq 'template' && defined($sys->{usids}) && ref($sys->{usids}) eq 'ARRAY' ) {
		$in = join(':', sort(@{$sys->{usids}}));
	} elsif ( defined($sys) ) {
		$in = $sys->{ts}.':'.$sys->{type}.':'.$sys->{name};
	} else {
		$in = time().':'.randString(128, 'A'..'Z', 'a'..'z', 0..9);
	}
	my $usid = md5_hex($in);
	$usid =~ s/\A(.{8})(.{4})(.{4})(.{4})(.{4})/$1-$2-$3-$4-$5/;
	return $usid;
}

=item B<loadSystemsList>

The function loads systems list from JSON file specified in global constant B<SYSTEMS_LIST> to B<@systems> global sharerd array.
It also generates self USID and put it back to the systems file if it doesn't contain self system.

The function takes no arguments.

The function returns nothing.

=cut
sub loadSystemsList {
	my $sl_fh;
	app->log->debug("Loading systems list ...");
	my $s;
	if ( open($sl_fh, '<', SYSTEMS_LIST) ) {
		$s = JSON::XS->new->allow_nonref->decode(join('', <$sl_fh>));
		close($sl_fh);
		my $sf = 0;
		foreach ( @$s ) {
			if ( defined($_->{type}) && defined($_->{usid}) && $_->{type} eq "self" ) {
				$sf = 1;
				$self_usid = $_->{usid};
			}
			push(@systems, shared_clone($_)) if ( defined($_->{name}) && defined($_->{usid}) &&
											defined($_->{type}) && defined($_->{ts}) &&
											((($_->{type} eq 'file' || $_->{type} eq 'template') && defined($_->{ufl}) && defined($_->{file})) ||
											($_->{type} eq 'host' && defined($_->{host})) || $_->{type} eq 'self') );
		}
	} else {
		app->log->debug("... unable to open systems list file: ".SYSTEMS_LIST);
	}
	unless ( defined($self_usid) ) {
		app->log->debug("Generating self USID...");
		my $host = $ENV{HOSTNAME};
		$host = $ENV{HOST} unless defined($host);
		$host = 'unknown' unless defined($host);
		$host =~ s/\..*//;
		$self_usid = updateSystem({name => $host, type => 'self', ts => time()});
	}
	app->log->info("Self USID: ".$self_usid);
	app->log->debug("... done (systems loaded: ".scalar(@systems).")");
	$state{"systems-ts"} = time();
}

=item B<mongoDBinit>

The function initializing MongoDB subsystem. This system could significantly improve web service performance
in case of retriving systems packages list and history.
The function also checks if all systems contained in MongoDB and import it from file otherwise.

The function takes no arguments.

The function returns nothing.

=cut
sub mongoDBinit {
	if ( !MONGODB_ENABLED ) {
		app->log->info("MongoDB subsystem is disabled. You may enable it to improve web service performance.");
		return;
	}
	app->log->debug("Initializing MongoDB subsystem ...");
	my ($mongo, $mongo_db, $mongo_systems, $mongo_sysdata);
	$mongo = MongoDB->connect(MONGODB_HOST);
	$mongo_db = $mongo->get_database(MONGODB_DB);
	$mongo_systems = $mongo_db->get_collection(MONGODB_SYSTEMS);
	$mongo_sysdata = $mongo_db->get_collection(MONGODB_SYSDATA);
	foreach my $sys ( @systems ) {
		app->log->debug(sprintf("checking [%s] (%s)", $sys->{usid}, $sys->{name}));
		my $mongo_sys = $mongo_systems->find({usid => $sys->{usid}});
		$mongo_sys->result();
		my $n = $mongo_sys->info()->{num};
		if ( $n == 1 ) {
			app->log->debug("... ok");
		} else {
			$mongo_systems->delete_many({usid => $sys->{usid}});
			$sys->{'_id'} = $sys->{usid};
			$mongo_systems->insert_one($sys);
			if ( $sys->{type} eq 'file' ) {
				if ( open(my $sys_fh, '<', $sys->{file}) ) {
					my $sd = JSON::XS->new->allow_nonref->decode(join('', <$sys_fh>));
					close($sys_fh);
					delete($sd->{pkgs});
					$sd->{'_id'} = $sys->{usid};
					$mongo_sysdata->insert_one($sd);
				} else {
					app->log->error(sprintf("Unable to open system file: %s", $sys->{file}));
				}
			}
			app->log->debug("... exported");
		}
	}
	app->log->debug("... done");
}

=item B<updateSystem>

The function updates system's data and save it. It's also used to generate USID for new systems before parsing the data into.

Arguments:

=over 5

=item 1: hash reference

First arguments is an hash reference to system's information to be stored in systems list.
If not defined only USID will be generated.

=item 2: string

USID of the system to be updated with the information from 1st argument.
If not defined, but 1st argument hash reference contains B<usid> key than this value will be used as USID.

=back

Return: string - USID of the system

=cut
sub updateSystem {
	my ($s, $usid) = @_;
	$s->{ts} = time() unless defined($s->{ts});
	$usid = $s->{usid} if ( !defined($usid) && defined($s) && defined($s->{usid}) );
	unless ( defined($usid) ) {
		$usid = genUSID($s);
		# Just return USID if no system data specified
		return $usid unless defined($s);
	}
	return unless defined($s);
	$s->{usid} = $usid unless defined $s->{usid};
	if ( MONGODB_ENABLED ) {
		my ($mongo, $mongo_db, $mongo_systems);
		eval {
			$mongo = MongoDB->connect(MONGODB_HOST);
			$mongo_db = $mongo->get_database(MONGODB_DB);
			$mongo_systems = $mongo_db->get_collection(MONGODB_SYSTEMS);
			$mongo_systems->delete_many({usid => $usid});
			unless ( defined($s->{remove}) && $s->{remove} ) {
				$s->{'_id'} = $usid;
				$mongo_systems->insert_one($s);
			}
		};
	}
	{
		my $fs;
		lock(@systems);
		for ( my $i = 0; $i < @systems; $i++ ) {
			if ( defined($systems[$i]->{usid}) && $systems[$i]->{usid} eq $usid ) {
				unlink($systems[$i]->{file}) if ( defined($s->{remove}) && $s->{remove} && defined($systems[$i]->{file}) );
				$systems[$i] = shared_clone($s);
				$fs = $i;
				last;
			}
		}
		push(@systems, shared_clone($s)) unless defined($fs);
	}
	@systems = grep({ !(defined($_->{remove}) && $_->{remove}) } @systems);
	my $json_fh;
	unless ( open($json_fh, '>', SYSTEMS_LIST) ) {
		app->log->debug("Unable to open systems list file for writing: ".SYSTEMS_LIST);
		return $usid;
	}
	print($json_fh JSON::XS->new->pretty->allow_nonref->encode(\@systems));
	close($json_fh);
	app->log->debug("Systems list saved (systems saved: ".scalar(@systems).")");
	$state{"systems-ts"} = time();
	return $usid;
}

sub updateExtSystems {
	my ($sr, $parent) = @_;
	return -1 if ( ref($sr) ne 'ARRAY' );
	foreach my $sys ( @{$sr} ) {
		if ( defined($sys->{usid}) ) {
			my %sys = %{$sys};
			$sys{prnt_usid} = $parent;
			$sys{prnt_sys} = getSystem($parent);
			$ext_systems->{$sys->{usid}} = \%sys;
		}
	}
}

=item B<getSystem>

The function return hash reference with system's data by USID specified.

Argument: string - USID to get system's data

Return: hash reference - system's data

=cut
sub getSystem {
	my ($usid, $ext) = @_;
	foreach ( @systems ) {
		if ( $_->{usid} eq $usid ) {
			return $_;
		}
	}
	return undef unless $ext;
	return $ext_systems->{$usid} if defined($ext_systems->{$usid});
	return undef;
}

=item B<getPackagesArray>

The function creates plain array list of the packages based on data from B<pkgs> structure from B<pkgs> section
of the system's structure or B<%pkgs> global shared hash in case if 1st variable not defined.

Arguments:

=over 5

=item 1: hash reference

The reference to B<pkgs> structure, if not specified B<%pkgs> global shared hash is used.

=item 2: array reference

The reference to the array to store plain list into. If not defined, new array will be created and the reference to this array will be returned.

=back

Return: array reference - the reference to the array containing the plain list of the packages, the same as 2nd argument if it was specified.

=cut
sub getPackagesArray {
	my ($ref, $ret, $g_insd) = @_;
	$g_insd = (defined($g_insd) && $g_insd) ? 1 : 0;
	my @a = ();
	my $rr = \@a;
	$rr = $ret if defined($ret);
	my $p = \%pkgs;
	my %s = (count => 0, installed => 0, removed => 0);
	$p = $ref->{pkgs} if defined($ref);
	foreach my $arch ( keys(%{$p}) ) {
		foreach my $name ( keys(%{$p->{$arch}}) ) {
			if ( defined($p->{$arch}{$name}{i}) || $g_insd ) {
				if ( defined($p->{$arch}{$name}{i}) && ref($p->{$arch}{$name}{i}) eq 'HASH' ) {
					$s{count}++;
					$s{installed}++;
					my %arow = %{$p->{$arch}{$name}{i}};
					$arow{name} = $name;
					$arow{arch} = $arch;
					$arow{mods} = defined($p->{$arch}{$name}{h}) ? scalar(@{$p->{$arch}{$name}{h}})-1 : 0;
					push(@{$rr}, shared_clone(\%arow));
				} elsif ( defined($p->{$arch}{$name}{i}) ) {
					my $hix = 0;
					my $hls = scalar(@{$p->{$arch}{$name}{i}})-1;
					foreach my $irow ( @{$p->{$arch}{$name}{i}} ) {
						$s{count}++;
						$s{installed}++;
						my %arow = %{$irow};
						$arow{name} = $name;
						$arow{arch} = $arch;
						$arow{mods} = ($hix == $hls) ? (defined($p->{$arch}{$name}{h}) ? scalar(@{$p->{$arch}{$name}{h}})-1 : 0) : 0;
						push(@{$rr}, shared_clone(\%arow));
						$hix++;
					}
				} elsif ( $g_insd && defined($p->{$arch}{$name}{h}) ) {
					foreach my $hrow ( reverse(@{$p->{$arch}{$name}{h}}) ) {
						if ( $hrow->{op} ne 'rm' ) {
							$s{count}++;
							$s{installed}++;
							my $gip = {name => $name, arch => $arch, installTime => $hrow->{ts},
								mods => scalar(@{$p->{$arch}{$name}{h}})};
							foreach my $vl ( ('ver', 'rel', 'repoName', 'repoAlias', 'vendor') ) {
								$gip->{$vl} = $hrow->{$vl} if defined($hrow->{$vl});
							}
							push(@{$rr}, shared_clone($gip));
							last;
						}
					}
				}
			} else {
				$s{count}++;
				$s{removed}++;
				push(@{$rr}, shared_clone({name => $name, arch => $arch, removed => 1,
					mods => defined($p->{$arch}{$name}{h}) ? scalar(@{$p->{$arch}{$name}{h}}) : 0}));
			}
		}
	}
	if ( defined($ref) ) {
		foreach ( keys(%s) ) {
			$ref->{'stat'}{$_} = $s{$_};
		}
	} else {
		foreach ( keys(%s) ) {
			$state{$_} = $s{$_};
		}
	}
	return $rr;
}

=item B<getHistoryArray>

The function returns items from B<@history> array according to the argument specified. The argument limits the number of items to return.

Argument: integer - last insert ID, the function returns only the records with B<hid> field larger than value specified
or full array if the value is 0.

Return: array reference - the reference to the array with items meet the limitation.

=cut
sub getHistoryArray {
	my $lid = shift;
	$lid = defined($lid) ? int($lid) : 0;
	updateHistoryArray($state{"history-last-id"}) if ( $lid > $state{"history-last-id"} );
	return \@history if ( $lid == 0 );
	my @a = ();
	app->log->debug("Returning partial history (>$lid)...");
	foreach ( @history ) {
		if ( $_->{hid} > $lid ) {
			my %hr = %{$_};
			push(@a, \%hr);
		}
	}
	app->log->debug("... done #".scalar(@a));
	return \@a;
}

=item B<getOSinfo>

The function returns hash reference containing basic environment information about running system.
This information is returning on B</info> requests.

The function takes no arguments.

Return: hash reference - basic environment information

=cut
sub getOSinfo {
	my %os_info;
	foreach ( glob("/etc/*-release") ) {
		textReadENV($_, \%os_info);
	}
	foreach (@env_v) {
		if ( defined($ENV{$_}) ) {
			$os_info{'ENV_'.$_} = $ENV{$_};
		}
	}
	return \%os_info;
}

=item B<getRepos>

The function returns array reference to the repositories list ordered by priority.

The function takes no arguments.

The 

=cut
sub getRepos {
	my @repos;
	foreach ( sort({$repos{$a}{priority} <=> $repos{$b}{priority}} keys(%repos)) ) {
		push(@repos, $repos{$_});
	}
	return \@repos;
}

=item B<textReadRPM>

The function is used to parse RPM lists text files.

Arguments:

=over 5

=item 1: string

The path to the file to parse.

=item 2: hash reference

The reference to the B<pkgs> structure to store the parsed data into.

=back

The function returns nothing.

=cut
sub textReadRPM {
	my ($fl, $pr) = @_;
	my $fl_fh;
	app->log->debug("Reading RPM txt $fl ...");
	open($fl_fh, '<', $fl) or return;
	app->log->debug("... open OK");
	my ($t, $cp, $tm, $dist, $vr, $vfy);
	$t = RLP_UNKNOWN;
	my ($qod, $sep);
	while ( my $l = <$fl_fh> ) {
		if ( $l =~ m!^# (?:[/\w]+|)rpm -qa --(?:queryformat|qf) (.*)! ) {
			my $qf = $1;
			$qf =~ s/^"//;
			$qf =~ s/"$//;
			my (@qfvs) = $qf =~ /\%\-?\d*\{\w+\}/g;
			my (@qvs) = $qf =~ /\%\{\w+\}/g;
			my (@qsp) = $qf =~ /(.)\%\{\w+\}/g;
			$sep = undef;
			foreach ( @qsp ) {
				if ( !defined($sep) && $_ gt '' ) {
					$sep = $_;
				} elsif ( $sep ne $_ ) {
					$sep = undef;
					last;
				}
			}
			if ( @qvs == @qfvs && $qf =~ /\%\-?\d*\{NAME\}/ && defined($sep) ) {
				my $vls = {NAME => "name",
					ARCH => "arch",
					VERSION => "ver",
					RELEASE => "rel",
					VENDOR => "vendor",
					INSTALLTIME => "installTime",
					DISTRIBUTION => "distr"};
				my $i = 0;
				foreach ( @qvs ) {
					$_ =~ s/\%\-?\d*\{(\w+)\}/$1/;
					if ( defined($vls->{$_}) ) {
						$qod->{$i} = $vls->{$_};
					}
					$i++;
				}
				$t = RLP_QUERY_CUSTOM;
			} elsif ( $qf =~ /\{NAME\}/ ) {
				$t = RLP_SR_QUERY;
			} else {
				$t = RLP_SKIP;
			}
		} elsif ( $l =~ m!^# ([/\w]+|)rpm -qa --last! ) {
			$t = RLP_QA_LAST;
		} elsif ( $l =~ m!^# ([/\w]+|)rpm -V (.*)! ) {
			$cp = $2;
			$t = RLP_SR_VERIFY;
			$vfy = '';
		} elsif ( ($t == RLP_SR_VERIFY) && $l =~ /^([\.SM5DLUGTP]{8}|missing)\s{2}(\s{2,3}|c\s)\S.*/ ) {
			$vfy .= $l;
		} elsif ( ($t == RLP_SR_VERIFY) && $l =~ /^$/ ) {
			$t = RLP_SKIP;
			my $s = splitNameVerRelArch($cp);
			$s->{verify} = $vfy if ( $vfy gt '' );
			packageDataAdd(ZDFLAG_UPDATE, $s, $pr);
		} elsif ( ($t == RLP_SR_QUERY) && (($cp, $dist, $vr) = $l =~ /^(\S+)\s+(\S[\S\s]{34})\s+(\S+)$/) ) {
			$dist =~ s/\s+$//;
			next if ( ($cp, $dist, $vr) = ("NAME", "DISTRIBUTION", "VERSION")  );
			my $s = splitNameVerRelArch($vr);
			$s->{name} = $cp;
			$s->{dist} = $dist;
			packageDataAdd(ZDFLAG_UPDATE, $s, $pr);
		} elsif ( $t == RLP_QUERY_CUSTOM && (my (@rqs) = split(quotemeta($sep), $l)) ) {
			next unless @rqs;
			chomp(@rqs);
			my $i = 0;
			my $s = {};
			foreach ( @rqs ) {
				$s->{$qod->{$i++}} = $_ if ( defined($qod->{$i}) );
			}
			packageDataAdd(ZDFLAG_UPDATE, $s, $pr);
		} elsif ( (($t == RLP_QA_LAST) && (($cp, $tm) = $l =~ /^(.{45}\S*\s)(.*)$/)) ||
					($t == RLP_UNKNOWN && (my ($pcp, $ptm) = $l =~ /^([^#]\S+)(?:\s+(.*)|)[\r\n]*$/)) ) {
			($cp, $tm) = ($pcp, $ptm) if ( $t == RLP_UNKNOWN );
			$cp =~ s/\s+$//;
			my $ut = s2time($tm);
			my $s = splitNameVerRelArch($cp);
			$s->{installTime} = $ut if ( $ut );
			packageDataAdd(ZDFLAG_UPDATE, $s, $pr);
		}
	}
	close($fl_fh);
}

=item B<textReadENV>

The function is used to parse basic environment text files.

Arguments:

=over 5

=item 1: string

The path to the file to parse.

=item 2: hash reference

The reference to the B<info> structure to store the parsed data into.

=back

The function returns nothing.

=cut
sub textReadENV {
	my ($fl, $inf) = @_;
	my %env_h = map({$_ => 1} @env_v);
	my $t = INF_UNKNOWN;
	my $fl_fh;
	my $relName;
	my $lc;
	app->log->debug("Reading ENV txt $fl ...");
	if ( $fl =~ m!\A/etc/(\w+)-release\z! ) {
		$relName = $1;
		$lc = 1;
		$t = INF_OSINFO;
	}
	open($fl_fh, '<', $fl) or return;
	my ($k, $v);
	while ( my $l = <$fl_fh> ) {
		$l =~ s/[\r\n]+\z//;
		if ( $l =~ m!\A#==\[ ! ) {
			$relName = undef;
			$lc = undef;
			$t = INF_UNKNOWN;
		} elsif ( $l =~ m!\A# /etc/(\w+)-release\z! ) {
			$relName = $1;
			$lc = 0;
			$t = INF_OSINFO;
		} elsif ( $l =~ m!\A# /usr/bin/env$! ) {
			$lc = undef;
			$t = INF_ENV;
		} elsif ( ($t == INF_OSINFO) ) {
			if ( ($k, $v) = $l =~ /^([\w\_]+) ?= ?(.*)/ ) {
				$v =~ s/^"//;
				$v =~ s/"$//;
				$v =~ s/\\"/"/g;
				$k = ($relName eq "os") ? $k : (($k =~ /\A${relName}_/i ? '' : uc($relName).'_').$k);
				$inf->{$k} = $v;
			} elsif ( $lc == 1 ) {
				chomp($l);
				$inf->{uc($relName).'_NAME'} = $l;
			}
		} elsif ( ($t == INF_ENV) && (($k, $v) = $l =~ /^([\w\_]+)=(.*)/) ) {
			$inf->{'ENV_'.$k} = $v if ( defined($env_h{$k}) );
		}
		$lc++ if ( defined($lc) );
	}
	close($fl_fh);
}

=item B<packageDataAdd>

The function is managing B<pkgs> structure to store the information into.

Arguments:

=over 5

=item 1: integer

The flag to set the mode of processing incoming information. The flag is a bitmask.

B<ZDFLAG_INSTALLED> - store the information from the 3rd argument to the list of installed packages

B<ZDFLAG_UPDATE> - update the package stored in the list of installed packages with new information in the 3rd argument. Merge mode.

B<ZDFLAG_SETREPO> - update the information about source repository if the package.

B<ZDFLAG_HISTORY> - store history information from the 3rd argument to the package history.

=item 2: hash reference

The reference to B<pkgs> structure to store data inside. If not specified, the data will be stored to B<%pkgs> global shared array.

=item 3: hash reference

The hash reference to package/history information to store in data structure specified in 2nd argument.

=back

The function returns nothing.

=cut
sub packageDataAdd {
	my ($zdflag, $pd, $pr) = @_;
	my $p = \%pkgs;
	my $st = \%state;
	foreach ( keys(%{$pd}) ) {
		delete($pd->{$_}) unless ( defined($pd->{$_}) );
	}
	if ( defined($pr) ) {
		$st = $pr->{'stat'};
		$p = $pr->{pkgs};
	}
	my ($name, $arch, $ver, $rel, $ts, $op) = ($pd->{name}, $pd->{arch},
		$pd->{ver}, $pd->{rel}, $pd->{ts}, $pd->{op});
	delete($pd->{name});
	delete($pd->{arch});
	return unless ( defined($name) && $name gt '' );
	$arch = '-' unless defined($arch);
	if ( $zdflag & ZDFLAG_INSTALLED ) {
		# Fill the installed packages data structure
		my $upd = 0;
		if ( $zdflag & ZDFLAG_UPDATE ) {
			my @match = qw(ver rel arch);
			my @merge = qw(var rel arch installTime distr vendor verify repoName repoAlias);
			if ( $arch eq '-' || (defined($p->{'-'}) && defined($p->{'-'}{$name})) ) {
				foreach my $ca ( keys(%{$p}) ) {
					if ( $arch ne $ca && ($arch eq '-' || $ca eq '-') && defined($p->{$ca}{$name}) ) {
						my ($from, $to) = ($ca ne '-') ? ($arch, $ca) : ($ca, $arch);
						unless ( defined($p->{$to}) ) {
							my %nms:shared;
							$p->{$to} = \%nms;
						}
						$p->{$to}{$name} = $p->{$from}{$name};
						delete($p->{$from}{$name});
						$arch = $to;
						last;
					}
				}
			}
			if ( defined($p->{$arch}) && defined($p->{$arch}{$name}) && defined($p->{$arch}{$name}{i}) ) {
				my ($mr, $mi, $smr);
				if ( ref($p->{$arch}{$name}{i}) eq 'HASH' ) {
					foreach (@match) {
						$mr++ if ( defined($p->{$arch}{$name}{i}{$_}) && defined($pd->{$_}) &&
								($p->{$arch}{$name}{i}{$_} eq $pd->{$_}) );
					}
					if ( $mr ) {
						$upd = 1;
						foreach (@merge) {
							$p->{$arch}{$name}{i}{$_} = $pd->{$_} if ( defined($pd->{$_}) &&
								(!defined($p->{$arch}{$name}{i}{$_}) || !($p->{$arch}{$name}{i}{$_} gt '')) );
						}
					}
				} else {
					for ( my $i = 0; $i < scalar(@{$p->{$arch}{$name}{i}}); $i++ ) {
						$mr = 0;
						foreach (@match) {
							$mr++ if ( defined($p->{$arch}{$name}{i}[$i]{$_}) && defined($pd->{$_}) &&
									($p->{$arch}{$name}{i}[$i]{$_} eq $pd->{$_}) );
						}
						if ( $mr == @match ) {
							$upd = 1;
							$mi = $i;
							last;
						} elsif ( !defined($smr) || (defined($smr) && ($mr > $smr)) ) {
							$smr = $mr;
							$mi = $i;
						}
					}
					$upd = 1 if ( !$upd && defined($mi) );
					if ( $upd ) {
						foreach (@merge) {
							$p->{$arch}{$name}{i}[$mi]{$_} = $pd->{$_} if ( defined($pd->{$_}) &&
								(!defined($p->{$arch}{$name}{i}[$mi]{$_}) || !($p->{$arch}{$name}{i}[$mi]{$_} gt '')) );
						}
					}
				}
			}
		}
		unless ( defined($p->{$arch}) ) {
			my %nms:shared;
			$p->{$arch} = \%nms;
		}
		$p->{$arch}{$name} = shared_clone({}) unless defined($p->{$arch}{$name});
		unless ( $upd ) {
			if ( defined($p->{$arch}{$name}{i}) ) {
				if ( ref($p->{$arch}{$name}{i}) eq 'HASH' ) {
					my %old = %{$p->{$arch}{$name}{i}};
					$p->{$arch}{$name}{i} = shared_clone([]);
					push(@{$p->{$arch}{$name}{i}}, shared_clone(\%old));
				}
				push(@{$p->{$arch}{$name}{i}}, shared_clone($pd));
			} else {
				$p->{$arch}{$name}{i} = shared_clone($pd);
			}
		}
		$st->{installed}++;
	}
	if ( $zdflag & ZDFLAG_SETREPO && defined($p->{$arch}) && defined($p->{$arch}{$name}) &&
				(defined($pd->{repoName}) || defined($pd->{repoAlias})) ) {
		# Update repository source data to already listed packages
		if ( ref($p->{$arch}{$name}{i}) eq 'HASH' ) {
			if ( $p->{$arch}{$name}{i}{ver} eq $ver && $p->{$arch}{$name}{i}{rel} eq $rel ) {
				$p->{$arch}{$name}{i}{repoName} = $pd->{repoName} if ( defined($pd->{repoName}) );
				$p->{$arch}{$name}{i}{repoAlias} = $pd->{repoAlias} if ( defined($pd->{repoAlias}) );
			}
		} else {
			foreach my $pi ( @{$p->{$arch}{$name}{i}} ) {
				if ( $pi->{ver} eq $ver && $pi->{rel} eq $rel ) {
					$pi->{repoName} = $pd->{repoName} if ( defined($pd->{repoName}) );
					$pi->{repoAlias} = $pd->{repoAlias} if ( defined($pd->{repoAlias}) );
					last;
				}
			}
		}
	}
	if ( $zdflag & ZDFLAG_HISTORY ) {
		# Fill the packages history data structure
		unless ( defined($p->{$arch}) ) {
			my %nms:shared;
			$p->{$arch} = \%nms;
		}
		$p->{$arch}{$name} = shared_clone({}) unless defined($p->{$arch}{$name});
		my $lid = $st->{"history-last-id"};
		$st->{"history-count"}++;
		$p->{$arch}{$name}{h} = shared_clone([]) unless ( defined($p->{$arch}{$name}{h}) );
		if ( scalar(@{$p->{$arch}{$name}{h}}) > 0 && $op eq "in" ) {
			my $pi = $#{$p->{$arch}{$name}{h}};
			my ($o_ver, $o_rel, $o_op) = ($p->{$arch}{$name}{h}[$pi]{ver},
						$p->{$arch}{$name}{h}[$pi]{rel}, $p->{$arch}{$name}{h}[$pi]{op});
			if ( $o_op ne 'rm' ) {
				my $r = vrcmp($ver, $rel, $o_ver, $o_rel);
				# Update operation type based on the version of previously installed package
				$op = $r == 0 ? 'rf' : ($r > 0 ? 'up' : 'dn');
			}
		}
		my $instd = 0;
		if ( defined($p->{$arch}{$name}{i}) ) {
			if ( ref($p->{$arch}{$name}{i}) eq 'HASH' ) {
				$instd = 1 if (vrcmp($ver, $rel, $p->{$arch}{$name}{i}{ver}, $p->{$arch}{$name}{i}{rel}) == 0);
				$p->{$arch}{$name}{i}{fInstTime} = $ts if $op eq 'in';
				delete($p->{$arch}{$name}{i}{fInstTime}) if $op eq 'rm';
			} else {
				foreach my $pi ( @{$p->{$arch}{$name}{i}} ) {
					$instd = 1 if (vrcmp($ver, $rel, $pi->{ver}, $pi->{rel}) == 0);
					$pi->{fInstTime} = $ts if $op eq 'in';
					delete($pi->{fInstTime}) if $op eq 'rm';
				}
			}
		}
		my $nh = {hid => ++$lid, op => $op, ver => $ver, rel => $rel, ts => $ts};
		$nh->{instd} = $instd if $instd;
		$nh->{idx} = $pd->{idx} if defined($pd->{idx});
		$nh->{batch} = $pd->{batch} if defined($pd->{batch});
		push(@{$p->{$arch}{$name}{h}}, shared_clone($nh));
		if ( defined($pd->{repoAlias}) ) {
			# Update repository source data if available
			my $i = $#{$p->{$arch}{$name}{h}};
			$p->{$arch}{$name}{h}[$i]{repoAlias} = $pd->{repoAlias};
			$p->{$arch}{$name}{h}[$i]{repoName} = defined($repos{$pd->{repoAlias}}) ?
					$repos{$pd->{repoAlias}}{name} : $pd->{repoAlias};
		}
		$st->{"history-".$op}++;
		$st->{"history-last-id"} = $lid;
	}
}

=item B<zyppInitRepos>

The function to initialize zypper repositories. It's managing B<%repos> shared hash.
Required to get the sources of installed packages.

The function takes no arguments.

The function returns nothing.

=cut
sub zyppInitRepos {
	app->log->debug("Loading repositories data...");
	lock(%repos);
	%repos = ();
	my $repoManager = zypp::RepoManager::new();
	my $zrepos = zypp::RepoManager::knownRepositories($repoManager);

	foreach my $repo ( @{$zrepos} ) {
		$repos{$repo->alias} = shared_clone({ name => $repo->asUserString, alias => $repo->alias,
				enabled => $repo->enabled() ? 1 : 0, priority => $repo->priority });
		if ( $repo->enabled() ) {
#			if ( ! zypp::RepoManager::isCached($repoManager,$repo) ) {
#				app->log->debug("Building cache of: ".$repo->name." (".$repo->alias.")");
#				zypp::RepoManager::buildCache($repoManager,$repo);
#			}
			app->log->debug("Loading cache: ".$repo->name." (".$repo->alias.")");
			zypp::RepoManager::loadFromCache($repoManager,$repo);
		}
	}
	app->log->debug("... done");
}

=item B<zyppReadPackages>

The function reads installed package from zypper instance and look for the source repository of the package

The function takes no arguments.

The function returns nothing.

=cut
sub zyppReadPackages {
	app->log->debug("Reading installed packages list from Zypper...");
	my $store = $zypp->pool;

	my $it_b = $store->cBegin;
	my $it_e = $store->cEnd;

	my $installed = {};

	while ( $store->iterator_equal($it_b, $it_e) != 1 ){
		my $pkg = $store->iterator_value($it_b);
		my $nm = $pkg->name."-".$pkg->edition->version."-".$pkg->edition->release.".".$pkg->arch->string;
		if ( $pkg->isKindPackage() && $pkg->status->isInstalled() ) {
			$installed->{$nm} = $pkg;
			# Add installed package to data structoure
			packageDataAdd(ZDFLAG_INSTALLED, {name => $pkg->name, arch => $pkg->arch->string,
						ver => $pkg->edition->version, rel => $pkg->edition->release, installTime => $pkg->installtime->asSeconds,
						repoName => $pkg->repository->asUserString, repoAlias => $pkg->repository->alias,
						vendor => $pkg->vendor->asString, distr => $pkg->distribution});
		} elsif ( $pkg->isKindPackage() && defined($installed->{$nm}) ) {
			my $opkg = $installed->{$nm};
			# Update package source data if package found in repository
			packageDataAdd(ZDFLAG_SETREPO, {name => $pkg->name, arch => $pkg->arch->string,
						ver => $pkg->edition->version, rel => $pkg->edition->release, repoName => $pkg->repository->asUserString,
						repoAlias => $pkg->repository->alias}) if ( $pkg->identical($opkg->satSolvable) );
		}
		$it_b = $store->iterator_incr($it_b);
	}
}

=item B<zyppReadHistory>

The function reading zypper history log file.

Arguments:

=over 5

=item 1: string

Zypper history file path.

=item 2: integer

History file reading mode. B<HIST_TAIL> - continious reading of live zypper history log, B<HIST_READ> - just read the file content and parse it.

=item 3: hash reference

The reference to data structure containing system information. B<undef> for current system.

=back

=cut
sub zyppReadHistory {
	my ($logFile, $mode, $pr) = @_;
	app->log->debug("History file reading thread started") if ( $mode == HIST_TAIL );
	my $hl_fh;
	open($hl_fh, '<', $logFile);
	my $lid = 0;
	$lid = $state{"history-last-id"} if ( $mode == HIST_TAIL );
	my $pt = 0;
	my $bt = 0;
	my $idx = 0;
	while ( 1 ) {
		my $c = 0;
		while ( my $l = <$hl_fh> ) {
			chomp($l);
			$c++;
			if ( my ($tm,$op,$name,$vr,$arch,$repoAlias) = $l =~ /\A([0-9\- :]+)\|([^\|]+)\|([^\|]+)\|([^\|]+)\|([^\|]+)\|[^\|]*\|([^\|]*)/ ) {
				my $ts = s2time($tm);
				$bt++ if ( $pt != 0 && (abs($ts-$pt) > BATCH_TIME_DELTA) );
				$pt = $ts;
				my ($ver,$rel) = getvr($vr);
				$op = $op eq "install" ? "in" : ($op =~ /\Aremove/ ? "rm" : "ND");
				packageDataAdd(ZDFLAG_HISTORY, {name => $name, arch => $arch, op => $op,
							ver => $ver, rel => $rel, ts => $ts, repoAlias => $repoAlias,
							idx => ++$idx, batch => $bt}, $pr) if ( defined($ver) );
			} elsif ( $l =~ /\A([0-9\- :]+)\|(radd|rremove)\s*\|([^\|]+)\|(?:([^\|]+)\||)(.*)/ &&
					($history_ctrl & HIST_TAIL & HIST_DONE) ) {
				{ lock($history_ctrl); $history_ctrl |= HIST_UPREPOS; cond_signal($history_ctrl); }
			}
		}
		if ( $mode != HIST_TAIL ) {
			close($hl_fh);
			return;
		}
		if ( $c > 0 ) {
			{
				lock(@packages);
				@packages = ();
				getPackagesArray(undef, \@packages);
			}
			updateHistoryArray($lid);
			$lid = $state{"history-last-id"};
			app->log->debug($c." lines read from history file. Sleeping for a while.");
			{ lock($history_ctrl); $history_ctrl |= HIST_DONE; cond_signal($history_ctrl); }
			zyppInitRepos() if $history_ctrl & HIST_UPREPOS;
		}
		{ lock($history_ctrl);  until ( $history_ctrl & HIST_STOP ) { last if !cond_timedwait($history_ctrl, time()+5); } }
		if ( $history_ctrl & HIST_STOP ) {
			close($hl_fh);
			return;
		}
		seek($hl_fh, 0, 1);
	}
	close($hl_fh);
}

sub saveSystem {
	my ($sysinfo, $r, $jfp) = @_;
	my $name = $sysinfo->{name};
	my $usid = $sysinfo->{usid};
	app->log->debug("Writing JSON output file for system name: ".$name."; ".$jfp);
	my $wr = open(my $json_fh, '>', $jfp);
	unless ( $wr ) {
		app->log->debug("ERROR writing JSON system file: ".$jfp);
		return;
	}
	print($json_fh JSON::XS->new->pretty->allow_nonref->encode($r));
	close($json_fh);
	if ( MONGODB_ENABLED ) {
		my ($mongo, $mongo_db, $mongo_sysdata);
		eval {
			$mongo = MongoDB->connect(MONGODB_HOST);
			$mongo_db = $mongo->get_database(MONGODB_DB);
			$mongo_sysdata = $mongo_db->get_collection(MONGODB_SYSDATA);
			$mongo_sysdata->delete_many({_id => $usid});
			$r->{'_id'} = $usid;
			delete($r->{pkgs});
			$mongo_sysdata->insert_one($r);
		};
	}
}

=item B<processUploadedFiles>

The function to load system information from uploaded files listed at the first argument array reference.

Arguments:

=over 5

=item 1: array reference

The reference to the array with files list.
Each element is an hash reference: {name => SYSTEM_NAME, path => PATH_INSIDE_TEMP_DIRECTORY, dir => TEMP_DIRECTORY}
The function is managing this array by appending and removing its elements for example on archive files extracting.

=item 2: string

Name of the system.

=item 3: hash reference

The reference to the hash to return the information about imported system.

=item 4: hash reference

The reference to the hash containing system information to be stored in systems list.

=back

The function returns nothing.

=cut
sub processUploadedFiles {
	my ($f, $name, $i, $sysinfo) = @_;
	my $usid = $sysinfo->{usid};
	my $r = { source => {name => $name, files => []}, info => {}, packages => [], history => [], pkgs => {},
		'stat' => { 'history-last-id' => 0,
					'history-count' => 0,
					'history-rm' => 0,
					'history-rf' => 0,
					'history-up' => 0,
					'history-dn' => 0,
					'history-in' => 0,
					'installed' => 0,
					'removed' => 0,
					'count' => 0} };
	my $jfp;
	my $ufl = '';
	$ufl = $usid.SYSTEM_EXTENSION;
	$jfp = SYSTEMS_DIR.$ufl;
	if ( -e $jfp ) {
		app->log->debug("ERROR: System file already exists: ".$jfp);
		return;
	}
	app->log->debug("Processing uploaded files into output: ".$jfp);
	foreach ( @$f ) {
		next unless defined($_->{path});
		my $p = $_->{path};
		my $dir = $_->{dir};
		my $dp = $dir.$p;
		if ( $p =~ /\.(tar|tgz|tbz2?|tar\.(gz|bz2))\z/i ) {
			$_ = undef;
			my ($lsp, $exp) = ('tf', 'xf');
			($lsp, $exp) = ('tjf', 'xjvf') if ($p =~ /\.(tbz|tar\.bz2?)\z/);
			($lsp, $exp) = ('tzf', 'xzvf') if ($p =~ /\.(tgz|tar\.gz?)\z/);
			my @fe;
			my $tar_fh;
			app->log->debug("Reading archive: ".$jfp." ...");
			open($tar_fh, '-|', 'tar', $lsp, $dp) or next;
			while ( <$tar_fh> ) {
				chomp;
				my $ex = m!/(?:(?:rpm|rpm-verify|env|basic-environment|zypper-history|history)\.txt|history|.+\.json|.+-release)\z!i ? 1 : 0;
				app->log->debug(" * ".($ex ? "enqueue" : "   skip")." * ".$_) unless m!/\z!;
				push(@fe, $_) if $ex;
			}
			close($tar_fh);
			app->log->debug("... done");
			my $tempDir = tempdir(DIR => $dir)."/";
			open($tar_fh, '-|', 'tar', $exp, $dp, '-C', $tempDir, @fe) or next;
			while ( <$tar_fh> ) {
				chomp;
				app->log->debug("Extracting: ".$_);
				push(@$f, {name => $name, path => $_, dir => $tempDir, src => $p.':'.$_});
			}
			close($tar_fh);
		} elsif ( $p =~ /(.*)\.(gz|bz2)\z/i ) {
			my ($bn, $be) = ($1, $2);
			$bn =~ s!.*[/\\]([^/\\]+)\z!$1!;
			my $bnn = $bn;
			$_ = undef;
			my $i = 0;
			while ( -e $dir.$bn ) {
				$bn = $bnn;
				$bn =~ s/(\.[^.]+\z)/-$i$1/;
				$i++;
			}
			open(my $ex_fh, '-|', $be =~ /\Agz\z/ ? 'gzip' : 'bzip2', '-d', $dp, '-c') or next;
			open(my $o_fh, '>', $dir.$bn) or next;
			print($o_fh join('', <$ex_fh>));
			close($o_fh);
			close($ex_fh);
			push(@$f, {name => $name, path => $bn, dir => $dir, src => $p.':'.$bn});
		}
	}
	# Define subroutine and sort file list with it's rules to process files with right order
	my $fncmp = sub {
		my ($a, $b) = @_;
		$a =~ s!.*[/\\]([^/\\]+)\z!$1!;
		$b =~ s!.*[/\\]([^/\\]+)\z!$1!;
		my ($an, $ae) = $a =~ m!(.*)(?:\.([^\.]+))\z!;
		my ($bn, $be) = $b =~ m!(.*)(?:\.([^\.]+))\z!;
		return ($an cmp $bn) if ( $ae =~ /\A\Q$be\z/i );
		return -1 if ( $ae =~ /\Ajson\z/i && $be !~ /\Ajson\z/i );
		return 1 if ( $be =~ /\Ajson\z/i && $ae !~ /\Ajson\z/i );
		return 1 if ( $an =~ /history/ );
		return -1 if ( $bn =~ /history/ );
		return -1 if ( $ae =~ /\Atxt\z/i && $be !~ /\Atxt\z/i );
		return 1 if ( $be =~ /\Atxt\z/i && $ae !~ /\Atxt\z/i );
		return -1 if ( $ae ne '' && $be eq '' );
		return 1 if ( $be ne '' && $ae eq '' );
		return $an cmp $bn;
	};
	@$f = sort({ &$fncmp($a->{path}, $b->{path}) } grep(defined, @$f));
	foreach ( @$f ) {
		next unless (defined($_) && defined($_->{path}));
		processUploadedFile($r, $_);
	}
	$r->{packages} = getPackagesArray($r, undef, ($r->{'stat'}{'installed'} < $r->{'stat'}{'history-in'}/4) ? 1 : 0);
	updateHistoryArray(0, $r);
	saveSystem($sysinfo, $r, $jfp);
	$i->{packages} = scalar(@{$r->{packages}});
	$i->{files} = scalar(@{$r->{source}{files}});
	$i->{'info-vars'} = scalar(keys(%{$r->{info}}));
	$sysinfo->{ufl} = $ufl;
	$sysinfo->{file} = $jfp;
}

=item B<processUploadedFile>

The function to load system information from uploaded file. 4 different file types are possible:

=over 5

JSON file containing whole system information created by Zypper monitor

Text file containing RPMs list installed in the system. For example rpm.txt from supportconfig.

Environment text files like env.txt and basic-environment.txt files from supportconfig.

Zypper history log file. (/var/log/zypp/history)

=back

Arguments:

=over 5

=item 1: hash reference

Complex data structure to store imported system information.

=item 2: hash reference

The element of an array from 1st argument array ref of B<processUploadedFiles>:
{name => SYSTEM_NAME, path => PATH_INSIDE_TEMP_DIRECTORY, dir => TEMP_DIRECTORY}

The function returns nothing.

=back

=cut
sub processUploadedFile {
	my ($r, $o) = @_;
	return unless defined($o->{path});
	my $p = $o->{path};
	my $s = defined($o->{src}) ? $o->{src} : $p;
	my $nm;
	my $dir = $o->{dir};
	($nm = $p) =~ s!.*[/\\]([^/\\]+)\z!$1!;
	my $t = "ENV";
	if ( $nm =~ /\.json\z/i ) {
		$t = "JSON";
	} elsif ( $nm =~ /history/i ) {
		$t = "HIST";
	} elsif ( $nm =~ /(?:rpm|package)/i ) {
		$t = "RPM";
	}
	app->log->debug("Processing ($t) $p ...");
	if ( $t eq "JSON" ) {
		my $jsn_fh;
		open($jsn_fh, '<', $dir.$p);
		$$r = JSON::XS->new->allow_nonref->decode(join('', <$jsn_fh>));
		close($jsn_fh);
	} elsif ( $t eq "HIST" ) {
		zyppReadHistory($dir.$p, HIST_READ, $r);
	} elsif ( $t eq "RPM" ) {
		textReadRPM($dir.$p, $r);
	} elsif ( $t eq "ENV" ) {
		textReadENV($dir.$p, $r->{info});
	}
	push(@{$r->{source}{files}}, $s) if $t =~ /\A(HIST|RPM|ENV)\z/;
	app->log->debug("... done");
}

=item B<getSystemFileJSONsection>

The function returns the specified section from JSON system file or all sections if the second parameter set to undef

Arguments:

=over 5

=item 1: string

The path to system file.

=item 2: string

The section name.

=back

Return: the reference to array of B<packages> or B<history> sections or B<info> hash reference.
In case of error returns the reference to hash with B<error> (error code) and B<msg> (text error description) elements.

=cut
sub getSystemFileJSONsection {
	my ($file, $section) = @_;
	app->log->debug("Reading file: ".$file);
	if ( open(my $jsn_fh, '<', $file) ) {
		my $dt = JSON::XS->new->allow_nonref->decode(join('', <$jsn_fh>));
		close($jsn_fh);
		if ( defined($section) && defined($dt->{$section}) ) {
			app->log->debug("Returning section ".$section);
			return {data => $dt->{$section}, cache => $dt};
		} elsif ( !defined($section) ) {
			app->log->debug("Returning all sections");
			return {data => $dt, cache => $dt};
		} else {
			return {error => "SECTION_NOT_FOUND", msg => "Requested section was not found in the file."};
		}
	}
	return {error => "FILE_NOT_ACCESSIBLE", msg => "File was not found or unable to be opened."};
}

sub zyppURLfix {
	my ($u) = @_;
	$u = 'https://'.$u if ($u !~ m!^http(s|)://!i && $u =~ m!:8843(/|$)!);
	$u = 'http://'.$u if $u !~ m!^http(s|)://!i;
	$u =~ s!^(http://)([^/:]+)(/|$)!$1$2:8880/!i;
	$u =~ s!^(https://)([^/:]+)(/|$)!$1$2:8843/!i;
	$u =~ s!/*$!/!;
	return $u;
}

sub getRemoteSystemSection {
	my ($usid, $system, $sect, $parms, $full) = @_;
	$system = getSystem($usid) if ( !defined($system) && defined($usid) );
	return undef unless defined($system);
	return -1 if ( $system->{type} ne 'host' || !defined($system->{host}) );
	my $url = zyppURLfix($system->{host}).$sect;
	my $next = 0;
	my $data = [];
	do {
		app->log->debug("Requesting from URL: ".$url);
		my $ua  = Mojo::UserAgent->new;
		$ua->request_timeout(32);
		my $res;
		eval {
			if ( AUTH_PTOKEN gt "" ) {
				$res = $ua->get($url => {'x-zyppmon-auth-token' => AUTH_PTOKEN} =>
						form => ((!$full && defined($parms)) ? $parms : {'next' => $next}))->result;
			} else {
				$res = $ua->get($url => form => ((!$full && defined($parms)) ? $parms : {'next' => $next}))->result;
			}
		};
		if ( $@ ) {
			return {error => "REQ_ERROR", msg => $@};
		} elsif ( $res->is_success ) {
			return $res->json if ( !$full );
			my $rd = $res->json;
			if ( ref($rd) eq 'HASH' && defined($rd->{ctrl}) && defined($rd->{data}) && ref($rd->{data}) eq 'ARRAY' ) {
				$next = $rd->{ctrl}{'next'};
				push(@{$data}, @{$rd->{data}});
			} elsif ( ref($rd) eq 'HASH' && !scalar(@{$data}) ) {
				return $rd;
			} else {
				app->log->debug("DEBUG: WHAT TO DO WITH THE RESPONSE: ".Dumper($rd));
				return undef;
			}
		} elsif ( $res->is_error ) {
			return {error => "REQ_ERROR", msg => $res->message};
		} else {
			return {error => "REQ_UNKNOWN", msg => "Unknown response returned."};
		}
	} while ( $full && defined($next) );
	return $data;
}

=item B<getSystemSection>

The function returns the specified system information section from MongoDB or JSON system file or all sections
if the second parameter set to undef

Arguments:

=over 5

=item 1: string

The USID of the system.

=item 2: string

The section name.

=item 3: integer

The number of element to start from. This parameter is only useful for packages and history sections.

=item 4: integer

The maximum number of elements to be returned. This parameter is only useful for packages and history sections.

=item 5: integer

Last insert ID, the function returns only the records with B<hid> field larger than value specified or full array if the value is 0.
Could be used with history section only.

=back

Return: the reference to array of B<packages> or B<history> sections or B<info> hash reference.
In case of error returns the reference to hash with B<error> (error code) and B<msg> (text error description) elements.

=cut
sub getSystemSection {
	my ($usid, $sect, $next, $max, $lid, $full) = @_;
	my $st = defined($next) ? int($next) : 0;
	my $mx = defined($max) ? int($max) : MAX_RETURN_ITEMS;
	my $s = getSystem($usid);
	if ( defined($s) ) {
		if ( $sect eq "packages" && $s->{type} eq "self" ) {
			return \@packages if $full;
			return getLimitedArray(\@packages, $next, $max);
		} elsif ( $sect eq "history" && $s->{type} eq "self" ) {
			return getHistoryArray($lid) if $full;
			return getLimitedArray(getHistoryArray($lid), $next, $max);
		} elsif ( $sect eq "info" && $s->{type} eq "self" ) {
			return getOSinfo();
		} elsif ( ($sect eq "stat" || $sect eq "check") && $s->{type} eq "self" ) {
			my %rs = %state;
			return \%rs;
		} elsif ( ($s->{type} eq "file" || $s->{type} eq "template") && defined($s->{file}) ) {
			if ( MONGODB_ENABLED ) {
				my ($mongo, $mongo_db, $mongo_sysdata);
				$mongo = MongoDB->connect(MONGODB_HOST);
				$mongo_db = $mongo->get_database(MONGODB_DB) if $mongo;
				$mongo_sysdata = $mongo_db->get_collection(MONGODB_SYSDATA) if $mongo_db;
				if ( $mongo_sysdata ) {
					if ( $sect =~ /^(packages|history)$/ ) {
						my $c = $mongo_sysdata->aggregate([{'$match' => {'_id' => $usid}},
															{'$project' => {'size' => { '$size' => '$'.$sect }}}]);
						my $sz = 0;
						if ( my $dt = $c->next() ) {
							$sz = $dt->{size} if defined($dt->{size});
						}
						if ( $mx && !$full ) {
							$c = $mongo_sysdata->aggregate([{'$match' => {'_id' => $usid}},
															{'$project' => {$sect => {'$slice' => [ '$'.$sect, $st, $mx ] }}}]);
						} else {
							$c = $mongo_sysdata->find({'_id' => $usid}, {'_id' => 0, $sect => 1});
						}
						if ( defined($c) && (my $dt = $c->next()) ) {
							return $dt->{$sect} if $full;
							my $ret = {size => $sz, start => $st, items => scalar(@{$dt->{$sect}}), 'maxReturn' => $mx};
							if ( $sz > $mx && $mx != 0 ) {
								$ret->{'next'} = $st+$mx unless ($ret->{items} < $mx);
							}
							return {ctrl => $ret, data => $dt->{$sect}};
						}
					} else {
						my $c = $mongo_sysdata->find_one({'_id' => $usid}, {'_id' => 0, $sect => 1});
						return $c->{$sect} if ( defined($c) && defined($c->{$sect}) );
					}
				}
			}
			my $r_ref = getSystemFileJSONsection($s->{file}, $sect);
			return $r_ref->{data} if $full;
			if ( (ref($r_ref) eq 'HASH') && defined($r_ref->{data}) && (ref($r_ref->{data}) eq 'ARRAY') ) {
				my $la = getLimitedArray($r_ref->{data}, $next, $max);
				$r_ref->{data} = $la->{data};
				$r_ref->{ctrl} = $la->{ctrl};
			}
			return $r_ref;
		} elsif ( $s->{type} eq "host" && defined($s->{host}) ) {
			return getRemoteSystemSection(undef, $s, $sect, undef, 1) if $full;
			return getRemoteSystemSection(undef, $s, $sect, {'next' => $next, 'mxcnt' => $max, 'lastid' => $lid});
		}
	}
	if ( defined($ext_systems->{$usid}) && defined($ext_systems->{$usid}{prnt_sys}) ) {
		return getRemoteSystemSection(undef, $ext_systems->{$usid}{prnt_sys}, $usid.'/'.$sect, undef, 1) if $full;
		return getRemoteSystemSection(undef, $ext_systems->{$usid}{prnt_sys}, $usid.'/'.$sect, {'next' => $next, 'mxcnt' => $max, 'lastid' => $lid});
	}
	return {error => "NOT_FOUND", msg => "System with specified USID was not found."};
}
=back
=cut

sub createSnapshot {
	my ($new_sys, $orig_sys) = @_;
	my $jfp;
	my $ufl = '';
	$ufl = $new_sys->{usid}.SYSTEM_EXTENSION;
	$jfp = SYSTEMS_DIR.$ufl;
	if ( -e $jfp ) {
		app->log->debug("ERROR: System file already exists: ".$jfp);
		return;
	}
	my $r = { source => {name => $new_sys->{name},
						orig_name => $orig_sys->{name},
						orig_usid => $orig_sys->{usid}},
			info => {}, packages => [], history => [], pkgs => {},
		'stat' => { 'history-last-id' => 0,
			'history-count' => 0,
			'history-rm' => 0,
			'history-rf' => 0,
			'history-up' => 0,
			'history-dn' => 0,
			'history-in' => 0,
			'installed' => 0,
			'removed' => 0,
			'count' => 0} };
	if ( defined($orig_sys->{prnt_sys}) ) {
		my $prnt_sys = $orig_sys->{prnt_sys};
		my $ousid = $orig_sys->{usid};
		my $ssr = getRemoteSystemSection(undef, $prnt_sys, $ousid.'/stat', undef, 1);
		$r->{'stat'} = $ssr;
		foreach my $sect ( ($ousid.'/info', $ousid.'/packages', $ousid.'/history') ) {
			$ssr = getRemoteSystemSection(undef, $prnt_sys, $sect, undef, 1);
			if ( $ssr && (ref($ssr) eq 'ARRAY' || ref($ssr) eq 'HASH') ) {
				$sect =~ s!\A[^/]+/!!;
				$r->{$sect} = $ssr;
			} else {
				app->log->debug("DEBUG: ".Dumper($ssr));
			}
		}
	} elsif ( $orig_sys->{type} eq 'self' ) {
		$r->{'stat'} = \%state;
		$r->{info} = getOSinfo();
		$r->{packages} = \@packages;
		$r->{history} = getHistoryArray();
		$r->{pkgs} = \%pkgs;
	} elsif ( $orig_sys->{type} eq 'host' ) {
		my $ssr = getRemoteSystemSection(undef, $orig_sys, 'check', undef, 1);
		$r->{'stat'} = $ssr;
		foreach my $sect ( ('info', 'packages', 'history') ) {
			$ssr = getRemoteSystemSection(undef, $orig_sys, $sect, undef, 1);
			if ( $ssr && (ref($ssr) eq 'ARRAY' || ref($ssr) eq 'HASH') ) {
				$r->{$sect} = $ssr;
			} else {
				app->log->debug("DEBUG: ".Dumper($ssr));
			}
		}
	} elsif ( $orig_sys->{type} eq 'file' ) {
		if ( open(my $jsn_fh, '<', $orig_sys->{file}) ) {
			eval {
				$r = JSON::XS->new->allow_nonref->decode(join('', <$jsn_fh>));
			};
			close($jsn_fh);
		}
		$r->{source}{name} = $new_sys->{name};
		$r->{source}{orig_name} = $orig_sys->{name};
		$r->{source}{orig_usid} = $orig_sys->{usid};
	}
	saveSystem($new_sys, $r, $jfp);
	$new_sys->{ufl} = $ufl;
	$new_sys->{file} = $jfp;
}

my $cmpdata = {};
sub uniq {
	my %k = map({ $_ => 1 } @_);
	my @k = keys(%k);
	return \@k;
}
sub compareSystems {
	my ($sys0, $sys1, $cmpid) = @_;
	my $cmpdt = {_id => $cmpid, cmpid => $cmpid, ts => time(), status => "ok",
				usid0 => $sys0->{usid}, usid1 => $sys1->{usid},
				info => {s0 => getSystemSection($sys0->{usid}, 'info', undef, undef, undef, 1),
						 s1 => getSystemSection($sys1->{usid}, 'info', undef, undef, undef, 1)},
				info_cmp => [],
				'stat' => {s0 => getSystemSection($sys0->{usid}, 'stat', undef, undef, undef, 1),
						   s1 => getSystemSection($sys1->{usid}, 'stat', undef, undef, undef, 1)},
				stat_cmp => [],
				packages => {s0 => getSystemSection($sys0->{usid}, 'packages', undef, undef, undef, 1),
							 s1 => getSystemSection($sys1->{usid}, 'packages', undef, undef, undef, 1)},
				packages_cmp => []};
	foreach my $s ( ('info', 'stat') ) {
		my $props = uniq(keys(%{$cmpdt->{$s}{s0}}), keys(%{$cmpdt->{$s}{s1}}));
		foreach my $p ( @{$props} ) {
			push(@{$cmpdt->{$s.'_cmp'}}, {p => $p, s0 => $cmpdt->{$s}{s0}{$p}, s1 => $cmpdt->{$s}{s1}{$p}});
		}
	}
	my $pd = {};
	foreach my $p0 ( @{$cmpdt->{packages}{s0}} ) {
		next if ( defined($p0->{removed}) && $p0->{removed} == 1 );
		my $aa = $p0->{arch} eq 'noarch' ? 'noarch' : '*';
		my $name = $p0->{name};
		if ( defined($pd->{$aa}) && defined($pd->{$aa}{$name}{s0}) && 
				ref($pd->{$aa}{$name}{s0}) eq 'HASH' ) {
			my $op0 = $pd->{$aa}{$name}{s0};
			$pd->{$aa}{$name}{s0} = [$op0, $p0];
		} elsif (defined($pd->{$aa}) && defined($pd->{$aa}{$name}{s0})) {
			push(@{$pd->{$aa}{$name}{s0}}, $p0);
		} else {
			$pd->{$aa}{$name}{s0} = $p0;
		}
	}
	foreach my $p1 ( @{$cmpdt->{packages}{s1}} ) {
		next if ( defined($p1->{removed}) && $p1->{removed} == 1 );
		my $aa = $p1->{arch} eq 'noarch' ? 'noarch' : '*';
		my $name = $p1->{name};
		if ( defined($pd->{$aa}) && defined($pd->{$aa}{$name}{s1}) && 
				ref($pd->{$aa}{$name}{s1}) eq 'HASH' ) {
			my $op1 = $pd->{$aa}{$name}{s1};
			$pd->{$aa}{$name}{s1} = [$op1, $p1];
		} elsif (defined($pd->{$aa}) && defined($pd->{$aa}{$name}{s1})) {
			push(@{$pd->{$aa}{$name}{s1}}, $p1);
		} else {
			$pd->{$aa}{$name}{s1} = $p1;
		}
	}
	foreach my $arch ( keys(%{$pd}) ) {
		foreach my $name ( keys(%{$pd->{$arch}}) ) {
			my $aa = $arch;
			if ( $aa eq '*' ) {
				my @aa = ();
				if ( defined($pd->{$arch}{$name}{s0}) ) {
					push(@aa, (ref($pd->{$arch}{$name}{s0}) eq 'ARRAY') ? $pd->{$arch}{$name}{s0}[0]->{arch} : $pd->{$arch}{$name}{s0}{arch});
				} else {
					push(@aa, '-');
				}
				if ( defined($pd->{$arch}{$name}{s1}) ) {
					push(@aa, (ref($pd->{$arch}{$name}{s1}) eq 'ARRAY') ? $pd->{$arch}{$name}{s1}[0]->{arch} : $pd->{$arch}{$name}{s1}{arch});
				} else {
					push(@aa, '-');
				}
				if ( $aa[0] eq '-' || $aa[1] eq '-' ) {
					$aa = ( $aa[1] eq '-' ) ? $aa[0] : $aa[1];
				} else {
					$aa = ($aa[0] ne $aa[1]) ? join('/', @aa) : $aa[0];
				}
			}
			if ( defined($pd->{$arch}{$name}{s0}) && defined($pd->{$arch}{$name}{s1}) &&
					ref($pd->{$arch}{$name}{s0}) eq 'HASH' && ref($pd->{$arch}{$name}{s1}) eq 'HASH' ) {
				push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
					vr0 => $pd->{$arch}{$name}{s0}{ver}.'-'.$pd->{$arch}{$name}{s0}{rel},
					vr1 => $pd->{$arch}{$name}{s1}{ver}.'-'.$pd->{$arch}{$name}{s1}{rel},
					vrc => vrcmp($pd->{$arch}{$name}{s1}{ver}, $pd->{$arch}{$name}{s1}{rel},
					$pd->{$arch}{$name}{s0}{ver}, $pd->{$arch}{$name}{s0}{rel})});
			} elsif ( defined($pd->{$arch}{$name}{s0}) && !defined($pd->{$arch}{$name}{s1}) ) {
				if ( ref($pd->{$arch}{$name}{s0}) eq 'HASH' ) {
					push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
						vr0 => $pd->{$arch}{$name}{s0}{ver}.'-'.$pd->{$arch}{$name}{s0}{rel},
						vr1 => '-',
						vrc => -1});
				} else {
					foreach my $ist ( @{$pd->{$arch}{$name}{s0}} ) {
						push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
							vr0 => $ist->{ver}.'-'.$ist->{rel},
							vr1 => '-',
							vrc => -1});
					}
				}
			} elsif ( !defined($pd->{$arch}{$name}{s0}) && defined($pd->{$arch}{$name}{s1}) ) {
				if ( ref($pd->{$arch}{$name}{s1}) eq 'HASH' ) {
					push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
						vr0 => '-',
						vr1 => $pd->{$arch}{$name}{s1}{ver}.'-'.$pd->{$arch}{$name}{s1}{rel},
						vrc => 1});
				} else {
					foreach my $ist ( @{$pd->{$arch}{$name}{s1}} ) {
						push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
							vr0 => '-',
							vr1 => $ist->{ver}.'-'.$ist->{rel},
							vrc => 1});
					}
				}
			} else {
				if ( ref($pd->{$arch}{$name}{s0}) eq 'HASH' ) {
					my $op0 = $pd->{$arch}{$name}{s0};
					$pd->{$arch}{$name}{s0} = [$op0];
				}
				if ( ref($pd->{$arch}{$name}{s1}) eq 'HASH' ) {
					my $op1 = $pd->{$arch}{$name}{s1};
					$pd->{$arch}{$name}{s1} = [$op1];
				}
				foreach my $p0 ( @{$pd->{$arch}{$name}{s0}} ) {
					foreach my $p1 ( @{$pd->{$arch}{$name}{s1}} ) {
						if ( $p0->{ver} eq $p1->{ver} && $p0->{rel} eq $p1->{rel} ) {
							$p0->{mf} = $p1->{mf} = 1;
							push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
								vr0 => $p0->{ver}.'-'.$p0->{rel},
								vr1 => $p1->{ver}.'-'.$p1->{rel},
								vrc => 0});
						}
					}
				}
				foreach my $p0 ( @{$pd->{$arch}{$name}{s0}} ) {
					push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
						vr0 => $p0->{ver}.'-'.$p0->{rel},
						vr1 => '-',
						vrc => -1}) unless defined($p0->{mf});
				}
				foreach my $p1 ( @{$pd->{$arch}{$name}{s1}} ) {
					push(@{$cmpdt->{packages_cmp}}, {name => $name, arch => $aa,
						vr0 => '-',
						vr1 => $p1->{ver}.'-'.$p1->{rel},
						vrc => 1}) unless defined($p1->{mf});
				}
			}
		}
	}
	delete($cmpdt->{info});
	delete($cmpdt->{stat});
	delete($cmpdt->{packages});
	if ( MONGODB_ENABLED ) {
		my ($mongo, $mongo_db, $mongo_cmpdata);
		$mongo = MongoDB->connect(MONGODB_HOST);
		$mongo_db = $mongo->get_database(MONGODB_DB);
		$mongo_cmpdata = $mongo_db->get_collection(MONGODB_CMPDATA);
		$mongo_cmpdata->delete_many({_id => $cmpid});
		$mongo_cmpdata->insert_one($cmpdt);
	}
	return $cmpdt;
}

sub createTemplate {
	my ($template_id, $new_sys) = @_;
	return undef unless (defined($new_sys->{usids}) && ref($new_sys->{usids}) eq 'ARRAY');
	my $jfp;
	my $ufl = '';
	$ufl = $new_sys->{usid}.SYSTEM_EXTENSION;
	$jfp = SYSTEMS_DIR.$ufl;
	my $usids = $new_sys->{usids};
	my $template = {_id => $template_id, ts => time(), label => '@'.strftime("%Y-%m-%d %T", localtime(time())),
					usids => $usids, systems => [], sysinfo => [], idx => {}, fp => {}};
	for ( my $i = 0; $i < scalar(@{$usids}); $i++ ) {
		$template->{idx}{$usids->[$i]} = $i;
		my $sys = getSystem($usids->[$i], 1);
		$template->{systems}[$i] = $sys;
		$template->{sysinfo}[$i] = getSystemSection($usids->[$i], 'info', undef, undef, undef, 1);
		my $stat = getSystemSection($usids->[$i], 'stat', undef, undef, undef, 1);
		$template->{sysinfo}[$i]{_usid} = $usids->[$i];
		$template->{sysinfo}[$i]{_system_name} = $sys->{name};
		$template->{sysinfo}[$i]{_installed} = $stat->{installed};
		my $pkgs = getSystemSection($usids->[$i], 'packages', undef, undef, undef, 1);
		foreach my $pkg ( @{$pkgs} ) {
			my $aa = $pkg->{arch} ne 'noarch' ? '*' : 'noarch';
			my $nm = $pkg->{name};
			$nm =~ s/\./*/g;
			unless (defined($pkg->{removed}) && $pkg->{removed}) {
				if ( defined($template->{fp}{$aa}{$nm}{$i}) ) {
					if ( ref($template->{fp}{$aa}{$nm}{$i}) eq 'ARRAY' ) {
						push(@{$template->{fp}{$aa}{$nm}{$i}}, {arch => $pkg->{arch}, ver => $pkg->{ver}, rel => $pkg->{rel}});
					} else {
						$template->{fp}{$aa}{$nm}{$i} = [$template->{fp}{$aa}{$nm}{$i}, {arch => $pkg->{arch}, ver => $pkg->{ver}, rel => $pkg->{rel}}];
					}
				} else {
					$template->{fp}{$aa}{$nm}{$i} = {arch => $pkg->{arch}, ver => $pkg->{ver}, rel => $pkg->{rel}};
				}
			}
		}
	}
	saveSystem($new_sys, $template, $jfp);
	$new_sys->{ufl} = $ufl;
	$new_sys->{file} = $jfp;
	return $new_sys;
}

my $analizedata = {};
sub analizeSystem {
	my ($template, $system, $analizeid) = @_;
	$analizedata->{$analizeid}{data} = [];
	my $tmplt = getSystemSection($template->{usid}, 'fp', undef, undef, undef, 1);
	my $sysinfo = getSystemSection($template->{usid}, 'sysinfo', undef, undef, undef, 1);
	my $pkgs = getSystemSection($system->{usid}, 'packages', undef, undef, undef, 1);
	my $pkgsc = scalar(@{$pkgs});
	my $sc = scalar(@{$sysinfo});
	my $r = {};
	if ( defined($pkgs) && ref($pkgs) eq 'ARRAY' && defined($tmplt) && ref($tmplt) eq 'HASH' ) {
		foreach my $pkg ( @{$pkgs} ) {
			next if ( defined($pkg->{removed}) && $pkg->{removed} );
			my $aa = $pkg->{arch} ne 'noarch' ? '*' : 'noarch';
			my $nm = $pkg->{name};
			$nm =~ s/\./*/g;
			if ( defined($tmplt->{$aa}) && defined($tmplt->{$aa}{$nm}) ) {
				my $asi = ($sc == scalar(keys(%{$tmplt->{$aa}{$nm}}))) ? 1 : 0;
				foreach my $i ( keys(%{$tmplt->{$aa}{$nm}}) ) {
					if ( ref($tmplt->{$aa}{$nm}{$i}) eq 'ARRAY' ) {
						foreach my $vrs ( @{$tmplt->{$aa}{$nm}{$i}} ) {
							if ( $vrs->{ver} eq $pkg->{ver} ) {
								$r->{$i}{v} = defined($r->{$i}{v}) ? $r->{$i}{v}+1 : 1;
								if ( $asi ) {
									$r->{$i}{va} = defined($r->{$i}{va}) ? $r->{$i}{va}+1 : 1;
								}
								if ( $vrs->{rel} eq $pkg->{rel} ) {
									$r->{$i}{vr} = defined($r->{$i}{vr}) ? $r->{$i}{vr}+1 : 1;
									if ( $asi ) {
										$r->{$i}{vra} = defined($r->{$i}{vra}) ? $r->{$i}{vra}+1 : 1;
									}
								}
							} else {
								$r->{$i}{e} = defined($r->{$i}{e}) ? $r->{$i}{e}+1 : 1;
							}
						}
					} else {
						if ( $tmplt->{$aa}{$nm}{$i}{ver} eq $pkg->{ver} ) {
							$r->{$i}{v} = defined($r->{$i}{v}) ? $r->{$i}{v}+1 : 1;
							if ( $asi ) {
								$r->{$i}{va} = defined($r->{$i}{va}) ? $r->{$i}{va}+1 : 1;
							}
							if ( $tmplt->{$aa}{$nm}{$i}{rel} eq $pkg->{rel} ) {
								$r->{$i}{vr} = defined($r->{$i}{vr}) ? $r->{$i}{vr}+1 : 1;
								if ( $asi ) {
									$r->{$i}{vra} = defined($r->{$i}{vra}) ? $r->{$i}{vra}+1 : 1;
								}
							}
						} else {
							$r->{$i}{e} = defined($r->{$i}{e}) ? $r->{$i}{e}+1 : 1;
						}
					}
				}
			}
		}
	}
	my @da;
	foreach my $i ( keys(%{$r}) ) {
		my $matchVR = (defined($sysinfo->[$i]{_installed}) && $sysinfo->[$i]{_installed} > 0) ?
					((defined($r->{$i}{vr}) ? $r->{$i}{vr} : 0) / ($sysinfo->[$i]{_installed} > $pkgsc ? $pkgsc : $sysinfo->[$i]{_installed}) ) : 0;
		my $match = (defined($sysinfo->[$i]{_installed}) && $sysinfo->[$i]{_installed} > 0) ?
					((defined($r->{$i}{v}) ? $r->{$i}{v} : 0) / ($sysinfo->[$i]{_installed} > $pkgsc ? $pkgsc : $sysinfo->[$i]{_installed}) ) : 0;
		push(@da, {usid => $sysinfo->[$i]{_usid}, systemName => $sysinfo->[$i]{_system_name},
					osName => $sysinfo->[$i]{PRETTY_NAME}, osVersion => $sysinfo->[$i]{VERSION_ID}, osArch => $sysinfo->[$i]{ENV_CPU},
					installed => $sysinfo->[$i]{_installed}, found => defined($r->{$i}{vr}) ? $r->{$i}{vr} : 0,
					match => $match, matchVR => $matchVR });
	}
	$analizedata->{$analizeid}{data} = \@da;
	$analizedata->{$analizeid}{status} = 'ok';
	return $analizedata->{$analizeid};
}

sub getRequestFP {
	my ($c) = @_;
	return md5_hex($c->req->headers->user_agent);
}

my $authKeys = {};
sub getCurrentAuthKey {
	my ($fp) = @_;
	my $tm = time();
	foreach my $authKey ( keys(%{$authKeys}) ) {
		if ( ($tm - $authKeys->{$authKey}{tm} < AUTHKEY_ALIVE) && ($authKeys->{$authKey}{fp} eq $fp) ) {
			return $authKey;
		} elsif ( $tm - $authKeys->{$authKey}{tm} > AUTHKEY_INTERVAL ) {
			delete($authKeys->{$authKey});
		}
	}
	my $newKey = md5_hex($tm.':'.randString(128, 'A'..'Z', 'a'..'z', 0..9));
	$authKeys->{$newKey} = {tm => $tm, fp => $fp};
	return $newKey;
}

my $authTokens = {};

sub checkAuth {
	my ($c, $gInfo) = @_;
	if ( AUTH_ORDER eq "none" ) {
		$c->render(json => {status => "ok", auth_required => "no", user => "-"}) if $gInfo;
		return 1;
	}
	my $fp = getRequestFP($c);
	my $reqToken = $c->req->headers->{headers}{'x-zyppmon-auth-token'};
	$reqToken = (defined($reqToken) && ref($reqToken) eq 'ARRAY') ? $reqToken->[0] : '';
	if ( $reqToken eq '' ) {
		my $xtoken = $c->req->param('x-jauth');
		$reqToken = $xtoken if ( defined($xtoken) && $xtoken gt '' );
	}
	if ( $reqToken eq '' ) {
		$c->render(json => {status => "error", error => "AUTH_NO_REQ_TOKEN", msg => "No token specified in the request."});
		return 0;
	}
	if ( AUTH_ORDER =~ /(^|\s)ptoken(\s|$)/ && AUTH_PTOKEN ne "" && $reqToken eq AUTH_PTOKEN ) {
		return 1;
	}
	if ( defined($authTokens->{$reqToken}) && ($authTokens->{$reqToken}{fp} eq $fp) ) {
		$c->render(json => {status => "ok", user => $authTokens->{$reqToken}{user}}) if $gInfo;
		return 1;
	}
	$c->render(json => {status => "error", error => "AUTH_INVALID_TOKEN", msg => "The token specified in the request is invalid."});
	return 0;
}

sub tryAuth {
	my ($login, $pass) = @_;
	my @auth_order = split(/\s+/, AUTH_ORDER);
	foreach my $auth ( @auth_order ) {
		if ( $auth eq 'mongodb' ) {
			my $mh = MONGODB_HOST;
			$mh =~ s!^(mongodb://)[^\@]+!$1$login:$pass!g;
			eval {
				my $mongo = MongoDB->connect($mh);
				my $mongo_db = $mongo->get_database(MONGODB_DB);
				my $mongo_test = $mongo_db->get_collection('test');
				$mongo_test->find_one();
			};
			return 1 unless($@);
		} elsif ( $auth eq 'bootstrap' ) {
			return 1 if ( BOOTSTRAP_LOGIN gt '' && BOOTSTRAP_PASSWD gt '' &&
				$login eq BOOTSTRAP_LOGIN && $pass eq BOOTSTRAP_PASSWD );
		}
	}
	return 0;
}

sub authLogin {
	my ($jauth, $fp) = @_;
	my $tm = time();
	$jauth = decode_base64($jauth);
	app->log->debug('AUTH FP: '.$fp);
	foreach my $authKey ( keys(%{$authKeys}) ) {
#		next if $authKeys->{$authKey}{tm} ne $fp;
		my $c = Crypt::CBC->new(
			-key    => $authKey,
			-cipher => "Crypt::Cipher::AES"
        );
		my $jd = $c->decrypt($jauth);
		app->log->debug('AUTH trying: '.$tm." cmp ".$authKeys->{$authKey}{tm}." / ".AUTHKEY_ALIVE." | ".$authKeys->{$authKey}{fp});
		if ( $jd =~ /^\{.*"login"\s*:\s*"/ && ($tm - $authKeys->{$authKey}{tm} < AUTHKEY_ALIVE) ) {
			$jauth = JSON::XS->new->allow_nonref->decode($jd);
			if ( defined($jauth->{login}) && defined($jauth->{passwd}) ) {
				$jauth->{login} = $c->decrypt(decode_base64($jauth->{login}));
				$jauth->{passwd} = $c->decrypt(decode_base64($jauth->{passwd}));
				if ( tryAuth($jauth->{login}, $jauth->{passwd}) ) {
					my $authToken = md5_hex($jauth->{login}.'@'.$tm.'@'.$fp);
					$authTokens->{$authToken} = {login => $jauth->{login}, passwd => $jauth->{passwd}, fp => $fp, tm => $tm};
					app->log->debug('AUTH "'.$jauth->{login}.'" OK');
					return {status => "ok", ok => "AUTH_OK", msg => "The user is authenticated.", authToken => $authToken};
				} else {
					app->log->debug('AUTH "'.$jauth->{login}.'" FAILED');
					return {status => "error", error => "AUTH_ERROR", msg => "Unable to authenticate the specified user."};
				}
			}
			last;
		} elsif ( $tm - $authKeys->{$authKey}{tm} > AUTHKEY_INTERVAL ) {
			app->log->debug('Deleting old key: '.$authKey);
			delete($authKeys->{$authKey});
		}
	}
	return {msg => "In development."};
}

sub redirectForceSecure {
	my ($c) = @_;
	return 0 unless (FORCE_SECURE && LISTEN_SECURE);
	return 0 if $c->req->url->base->scheme eq "https";
	return 1 unless defined($c->req->url->base->host);
	$c->redirect_to('https://'.$c->req->url->base->host.':'.LISTEN_SECURE_PORT.$c->req->url->path);
	return 1;
}

# Suppress some initialization steps if ZYPPMONAPP_FASTRUN environment variable set to any value
# Useful for some testing purposes.
# Please note that the following features will not work in this case:
# - Resolution of the source repository of the package installed
# - Reading the packages installed
# - Reading the systems from JSONs
# - Loading zypper history log data
unless ( defined($ENV{ZYPPMONAPP_FASTRUN}) ) {
	zyppInitRepos();

	zyppReadPackages();

	loadSystemsList();
	
	mongoDBinit();

	# Getting zypper history log file
	my $zconf = zyppc::ZConfig_instance();
	my $hLogFile = $zconf->historyLogFile->asString();
	app->log->debug("Zypper history file: ".$hLogFile);
	# Loading zypper history log data and waiting the separated thread to finish reading data.
	$tthread = async {
		zyppReadHistory($hLogFile, HIST_TAIL);
	};
	sleep(2);
	app->log->debug("Waiting for finishing history reading...");
	{ lock($history_ctrl); cond_wait($history_ctrl) until $history_ctrl & HIST_DONE; }
	app->log->debug("Total number of packages processed: ".scalar(@packages));
}

=head1 WEB SERVICE ROUTES

=item B</check>

Get the hash with the system state information.

=cut
any '/:chk' => [chk => ['check', 'stat']] => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	$c->render(json => \%state);
};

=item B</repos>

Get the array of the system's reppsitories.

=cut
any '/repos' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	$c->render(json => getRepos());
};

=item B</info>

Get the hash with the system information.

=cut
any '/info' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	$c->render(json => getOSinfo());
};

=item B</packages>

Get the array of the system's packages.

=cut
any '/packages' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	my $mxcnt = $c->req->param('mxcnt');
	my $next = $c->req->param('next');
	my $token = $c->req->param('token');
	$c->inactivity_timeout(INACTIVITY_TIMEOUT);
	$c->subprocess(
		sub {
			return getLimitedArray(\@packages, $next, $mxcnt);
		},
		sub {
			my ($c, $r_ref) = @_;
			if ( ref($r_ref) eq 'HASH' && defined($r_ref->{ctrl}) && $token ) {
				$r_ref->{ctrl}{token} = $token;
			}
			$c->render(json => $r_ref);
		}
	);
};

=item B</history>

Get the array of the system's packages history.

=cut
any '/history' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	my $mxcnt = $c->req->param('mxcnt');
	my $next = $c->req->param('next');
	my $lid = $c->req->param('lastid');
	my $token = $c->req->param('token');
	$c->inactivity_timeout(INACTIVITY_TIMEOUT);
	$c->subprocess(
		sub {
			return getLimitedArray(getHistoryArray($lid), $next, $mxcnt);
		},
		sub {
			my ($c, $r_ref) = @_;
			if ( ref($r_ref) eq 'HASH' && defined($r_ref->{ctrl}) && $token ) {
				$r_ref->{ctrl}{token} = $token;
			}
			$c->render(json => $r_ref);
		}
	);
};

=item B</system>

Get the current system internals.

=cut
any '/system' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	$c->render(json => getSystem($self_usid));
};

=item B</systems>

Get the array with systems list.

=cut
any '/systems' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	$c->render(json => \@systems);
};

any '/systems/setOrder' => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	return unless checkAuth($c);
	my $order = $c->req->param('order');
	if ( !$order ) {
		$c->render(json => {status => "error", error => "NO_ORDER_PARAM_SET",
							msg => "The order parameter was not specified in the request."});
		return;
	}
	$order = ';'.$order.';';
	@systems = sort({index($order, $a->{usid}) <=> index($order, $b->{usid})} @systems);
	$order = $c->req->param('order');
	my $s = getSystem($self_usid);
	$s->{ts} = time();
	updateSystem($s);
	$c->render_maybe(json => {status => "ok", ok => "SYSTEMS_ORDER_UPDATED",
						msg => "Systems order was updated."});
	$c->subprocess(
		sub {
			foreach my $sys ( @systems ) {
				if ( $sys->{type} eq 'host' && defined($sys->{host}) ) {
					my $url = zyppURLfix($sys->{host}).'systems/setOrder';
					my $ua  = Mojo::UserAgent->new;
					$ua->request_timeout(32);
					my $res;
					eval {
						if ( AUTH_PTOKEN gt "" ) {
							$res = $ua->get($url => {'x-zyppmon-auth-token' => AUTH_PTOKEN} => form => {'order' => $order})->result;
						} else {
							$res = $ua->get($url => form => {'order' => $order})->result;
						}
					};
				}
			}
			return 0;
		},
		sub {
			app->log->debug("Sending systems order to all host systems done.");
		}
	);
};

=item B</USID/info>

=item B</USID/packages>

=item B</USID/history>

Get the appropriate section for the system with USID specified.
The same as B</info>, B</packages> and B</history>, but not for local system, but for USID specified.
The list of available USIDs could be retrived with B</systems>

=cut
any '/:usid/:sect' => [sect => ['check', 'stat', 'info', 'packages', 'history', 'system', 'systems']] => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	my $sect = $c->param('sect');
	my $usid = $c->param('usid');
	return unless checkAuth($c);
	my $mx = $c->req->param('mxcnt');
	$mx = defined($mx) ? int($mx) : MAX_RETURN_ITEMS;
	my $next = $c->req->param('next');
	my $lid = $c->req->param('lastid');
	my $token = $c->req->param('token');
	my $tm = time();
	app->log->debug("Request for [".$sect."] of USID: ".$usid);
	$c->inactivity_timeout(INACTIVITY_TIMEOUT);
	$c->subprocess(
		sub {
			if ( $sect eq 'system' ) {
				my $sR = getSystem($usid);
				return {error => "NOT_FOUND", msg => "System with specified USID was not found."} unless defined($sR);
				return getSystemSection($usid, $sect) if $sR->{type} eq "host";
				my %s = %{$sR};
				return \%s;
			}
			if ( defined($cache->{$usid}) && ($cache->{$usid}{ttl} > $tm) ) {
				$cache->{$usid}{ttl} = $tm+CACHE_TTL;
				app->log->debug("Cached data found.");
				return getLimitedArray($cache->{$usid}{dt}{$sect}, $next, $mx);
			}
			return getSystemSection($usid, $sect, $next, $mx, $lid);
		},
		sub {
			foreach ( keys(%{$cache}) ) {
				delete($cache->{$_}) if ( $cache->{$_}{ttl} < $tm );
			}
			my ($c, $r_ref) = @_;
			if ( ref($r_ref) ) {
				updateExtSystems($r_ref, $usid) if ( $sect eq 'systems' && ref($r_ref) eq 'ARRAY' );
				if ( ref($r_ref) eq 'HASH' && defined($r_ref->{data}) && defined($r_ref->{cache}) ) {
					$cache->{$usid} = {dt => $r_ref->{cache}, ttl => $tm+CACHE_TTL};
					delete($r_ref->{cache});
				}
				if ( ref($r_ref) eq 'HASH' && defined($r_ref->{ctrl}) && $token ) {
					$r_ref->{ctrl}{token} = $token;
				}
				$c->render(json => $r_ref);
			} else {
				$c->render(text => $r_ref, format => 'json');
			}
		}
	);
};

=item B</system/add/file>

Add new system with type=file based on information from uploaded file(s).

Parameters:

=over 5

usn - The name of the system.

=back

=cut
post '/system/add/file' => sub {
	my $c = shift;
	my $usn = $c->req->param('usn');
	return unless checkAuth($c);
	unless ( defined($usn) ) {
		$c->render(data => encode_json({ error => "name was not specified!" }));
		return;
	}
	my $new_system = {name => $usn, type => "file"};
	my $usid = updateSystem($new_system);
	app->log->debug("Starting subprocess to import system <".$usn."/".$usid."> ...");
	$c->render_maybe(json => { name => $usn, usid => $usid, status => "pending" });
	$c->subprocess(
		sub {
			eval {
				my @files;
				my $tempDir = tempdir(DIR => UPLOAD_DIR)."/";
				app->log->debug("Processing uploaded files. System name: ".$usn);
				app->log->debug("Temporary directory created: ".$tempDir);
				my %inf;
				for my $file (@{$c->req->uploads('uploadFile')}) {
					my $path = $tempDir.$file->filename;
					$file->move_to($path);
					app->log->debug("File was moved to: ".$path);
					push(@files, {name => $usn, path => $file->filename, dir => $tempDir});
				}
				app->log->debug("Start files processing...");
				processUploadedFiles(\@files, $usn, \%inf, $new_system);
				rmtree($tempDir);
				app->log->debug("Temporary directory removed: ".$tempDir);
			};
			if ( $@ ) {
				my $err = $@;
				chomp($err);
				app->log->debug("Error in thread: ".$err);
			}
			return $new_system;
		},
		sub {
			my ($delay, $system_inf) = @_;
			app->log->debug("... subprocess <".$usn."/".$usid."> finished");
			updateSystem($system_inf);
		}
	);
};

=item B</system/add/host>

Add new system with type=host.

Parameters:

=over 5

usn - The name of the system.

host - The host and port of the remote system. ("host:port", "host", "protocol://host:port" or "protocol://host:port/USID")

=back

=cut
any '/system/add/host' => sub {
	my $c = shift;
	return unless checkAuth($c);
	my $name = $c->req->param('usn');
	my $host = $c->req->param('host');
	if ( defined($name) && defined($host) && $name gt '' && $host gt '' ) {
		my $usid = updateSystem({name => $name, host => $host, type => 'host'});
		$c->render(json => getSystem($usid));
	} else {
		$c->render(json => {status => "error", error => "NO_REQUIRED", msg => "One of required values was not specified (usn or host)."});
	}
};

=item B</system/get/USID>

=item B</system/remove/USID>

=item B</system/delete/USID>

=item B</system/rename/USID>

=item B</system/snapshot/USID>

Do the specified action with the system USID specified: B<get>, B<remove>, B<delete> (the same as B<remove>), B<rename> or B<snapshot>.

=cut
any '/system/:op/:usid' => [op => ['get', 'remove', 'delete', 'rename', 'snapshot']] => sub {
	my $c = shift;
	return unless checkAuth($c);
	my $op = $c->param('op');
	my $usid = $c->param('usid');
	my $s = getSystem($usid, ($op =~ /\Aget|snapshot\z/) ? 1 : 0);
	if ( defined($s) ) {
		if ( $op eq 'get' ) {
			my %sys = %{$s};
			delete($sys{prnt_sys});
			$c->render(json => \%sys);
		} elsif ( $op eq 'rename' ) {
			my $name = $c->req->param('usn');
			if ( defined($name) && $name gt '' ) {
				$s->{name} = $name;
				updateSystem($s);
				$c->render(json => $s);
			} else {
				$c->render(json => {status => "error", error => "NO_NEW_NAME",
									msg => "No new name specified.", usid => $usid});
			}
		} elsif ( $op eq 'remove' || $op eq 'delete' ) {
			if ( $s->{type} ne 'self' ) {
				$s->{remove} = 1;
				updateSystem($s);
				$c->render(json => {status => "done", msg => "System was deleted.", usid => $usid});
			} else {
				$c->render(json => {status => "error", error => "IMPOSSIBLE_SELF_DELETE",
									msg => "It's not possible to delete self system.", usid => $usid});
			}
		} elsif ( $op eq 'snapshot' ) {
			my $usn = $s->{name}.' #'.strftime("%Y-%m-%d %T", localtime(time()));
			my $new_system = {name => $usn, type => "file"};
			my $nusid = updateSystem($new_system);
			app->log->debug("Starting subprocess to create a snapshot if the system <".$usn."/".$nusid."> ...");
			$c->render_maybe(json => { name => $usn, usid => $nusid, status => "pending" });
			$c->subprocess(
				sub {
					eval {
						createSnapshot($new_system, $s);
					};
					if ( $@ ) {
						my $err = $@;
						chomp($err);
						app->log->debug("Error in thread: ".$err);
					}
					return $new_system;
				},
				sub {
					my ($delay, $system_inf) = @_;
					app->log->debug("... subprocess <".$usn."/".$usid."> finished");
					updateSystem($system_inf);
				}
			);
		} else {
			$c->render(json => {status => "error", error => "NOT_IMPLEMENTED",
								msg => "This function is not implemented yet.", usid => $usid});
		}
	} else {
		$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The system was not found.", usid => $usid});
	}
};

any '/compare/get/:cmpid/:sect' => sub {
	my $c = shift;
	return unless checkAuth($c);
	my $cmpid = $c->param('cmpid');
	my $sect = $c->param('sect');
	my $mx = $c->req->param('mxcnt');
	$mx = defined($mx) ? int($mx) : MAX_RETURN_ITEMS;
	my $next = $c->req->param('next');
	my $token = $c->req->param('token');
	if ( !defined($cmpdata->{$cmpid}) ) {
		$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The comparison was not found.", cmpid => $cmpid});
		return;
	}
	if ( $cmpdata->{$cmpid}{status} ne "ok" || $sect eq "check" ) {
		$c->render(json => {cmpid => $cmpid,
				usid0 => $cmpdata->{$cmpid}{usid0},
				usid1 => $cmpdata->{$cmpid}{usid1},
				status => $cmpdata->{$cmpid}{status}});
		return;
	}
	if ( !defined($cmpdata->{$cmpid}{$sect}) ) {
		$c->render(json => {status => "error", error => "SECTION_NOT_FOUND",
							msg => "The comparison section was not found.", cmpid => $cmpid, section => $sect});
		return;
	}
	$c->inactivity_timeout(INACTIVITY_TIMEOUT);
	$c->subprocess(
		sub {
			if ( ref($cmpdata->{$cmpid}{$sect}) eq 'ARRAY' ) {
				return getLimitedArray($cmpdata->{$cmpid}{$sect}, $next, $mx);
			}
			return $cmpdata->{$cmpid}{$sect};
		},
		sub {
			my ($c, $r_ref) = @_;
			my $ret;
			if ( ref($r_ref) ) {
				if ( ref($r_ref) eq 'HASH' && !(defined($r_ref->{ctrl}) && defined($r_ref->{data})) ) {
					$ret = {ctrl => {}, data => $r_ref};
				}
				if ( ref($r_ref) eq 'HASH' && defined($r_ref->{ctrl}) ) {
					$r_ref->{ctrl}{token} = $token if ($token);
					$r_ref->{ctrl}{cmpid} = $cmpid;
					$r_ref->{ctrl}{section} = $sect;
				}
				$c->render(json => $r_ref);
			} else {
				$c->render(text => $r_ref, format => 'json');
			}
		}
	);
};

any '/compare/:usid0/:usid1' => sub {
	my $c = shift;
	return unless checkAuth($c);
	my $usid0 = $c->param('usid0');
	my $usid1 = $c->param('usid1');
	my $cmpid = md5_hex($usid0.':'.$usid1);
	my $sys0 = getSystem($usid0, 1);
	my $sys1 = getSystem($usid1, 1);
	if ( !defined($sys0) ) {
		$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The system #0 was not found.", usid => $usid0});
		return;
	}
	if ( !defined($sys1) ) {
		$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The system #1 was not found.", usid => $usid1});
		return;
	}
	app->log->debug("Starting subprocess to compare the systems <".$cmpid."> ...");
	app->log->debug("...#0: ".$sys0->{name});
	app->log->debug("...#1: ".$sys1->{name});
	$cmpdata->{$cmpid} = {cmpid => $cmpid, usid0 => $usid0, usid1 => $usid1, status => "pending"};
	$c->render_maybe(json => $cmpdata->{$cmpid});
	$c->subprocess(
		sub {
			my $cmp_rslt;
			eval {
				app->log->debug("Start compare processing...");
				$cmp_rslt = compareSystems($sys0, $sys1, $cmpid);
			};
			if ( $@ ) {
				my $err = $@;
				chomp($err);
				app->log->debug("Error in thread: ".$err);
			}
			return $cmp_rslt;
		},
		sub {
			my ($delay, $cmp_rslt) = @_;
			$cmpdata->{$cmpid} = $cmp_rslt;
			app->log->debug("... subprocess <".$cmpid."> finished");
		}
	);
};

any '/templates/:cmd' => [cmd => ['create', 'analize', 'checkAnalize', 'getAnalize']] => sub {
	my $c = shift;
	return unless checkAuth($c);
	my $cmd = $c->param('cmd');
	my $template_id;
	my @usids = ();
	if ( $cmd eq 'checkAnalize' ) {
		my $analizeid = $c->req->param('analizeid');
		unless ( defined($analizeid) && defined($analizedata->{$analizeid}) ) {
			$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The analize ID was not found.", analizeid => $analizeid});
			return;
		}
		$c->render(json => {analizeid => $analizeid,
				system_usid => $analizedata->{$analizeid}{system_usid},
				template_usid => $analizedata->{$analizeid}{template_usid},
				status => $analizedata->{$analizeid}{status}});
		return;
	} elsif ( $cmd eq 'getAnalize' ) {
		my $analizeid = $c->req->param('analizeid');
		unless ( defined($analizeid) && defined($analizedata->{$analizeid}) ) {
			$c->render(json => {status => "error", error => "NOT_FOUND",
							msg => "The analize ID was not found.", analizeid => $analizeid});
			return;
		}
		$c->render(json => {analizeid => $analizeid,
				system_usid => $analizedata->{$analizeid}{system_usid},
				template_usid => $analizedata->{$analizeid}{template_usid},
				data => $analizedata->{$analizeid}{data}});
		return;
	} elsif ( $cmd eq 'create' ) {
		my $count = $c->req->param('count');
		for ( my $i = 0; $i < $count; $i++ ) {
			my $usid = $c->req->param('usid'.$i);
			my $sys = getSystem($usid, 1);
			if ( $sys ) {
				push(@usids, $usid);
			} else {
				$c->render(json => {status => "error", error => "NOT_FOUND",
									msg => "The system with USID: '.$usid.' was not found.", usid => $usid});
				last;
			}
		}
		my $usn = '#'.strftime("%Y-%m-%d %T", localtime(time())).'/'.$count;
		my $new_system = {name => $usn, type => "template", usids => \@usids};
		$template_id = updateSystem($new_system);
		$new_system->{name} .= '/'.substr($template_id, 0, 8);
		app->log->debug("Starting subprocess to create compare template <".$template_id."> ...");
		$c->render_maybe(json => { templateID => $template_id, usids => \@usids, status => "pending" });
		$c->subprocess(
			sub {
				my $tmpl_rslt;
				eval {
					app->log->debug("Start creating compare template...");
					$tmpl_rslt = createTemplate($template_id, $new_system);
				};
				if ( $@ ) {
					my $err = $@;
					chomp($err);
					app->log->debug("Error in thread: ".$err);
				}
				return $tmpl_rslt;
			},
			sub {
				my ($delay, $system_inf) = @_;
				updateSystem($system_inf);
				app->log->debug("... subprocess <".$template_id."> finished");
			}
		);
	} elsif ( $cmd eq 'analize' ) {
		my $template_usid = $c->req->param('template');
		my $system_usid = $c->req->param('system');
		unless ( defined($template_usid) && defined($system_usid) ) {
			$c->render(json => {status => "error", error => "NO_REQUIRED_PARAMS",
							msg => "One or both parameters was not specified: system, template"});
			return;
		}
		my $analizeid = md5_hex($template_usid.':'.$system_usid);
		my $template = getSystem($template_usid, 1);
		my $system = getSystem($system_usid, 1);
		if ( !defined($template) ) {
			$c->render(json => {status => "error", error => "NOT_FOUND",
								msg => "The template was not found.", usid => $template_usid});
			return;
		}
		if ( !defined($system) ) {
			$c->render(json => {status => "error", error => "NOT_FOUND",
								msg => "The system was not found.", usid => $system_usid});
			return;
		}
		app->log->debug("Starting subprocess to analize the system <".$analizeid."> ...");
		app->log->debug("...template: ".$template->{name});
		app->log->debug(".....system: ".$system->{name});
		$analizedata->{$analizeid} = {analizeid => $analizeid, template => $template_usid, 'system' => $system_usid, status => "pending"};
		$c->render_maybe(json => $analizedata->{$analizeid});
		$c->subprocess(
			sub {
				my $analize_rslt;
				eval {
					app->log->debug("Start analize processing...");
					$analize_rslt = analizeSystem($template, $system, $analizeid);
				};
				if ( $@ ) {
					my $err = $@;
					chomp($err);
					app->log->debug("Error in thread: ".$err);
				}
				return $analize_rslt;
			},
			sub {
				my ($delay, $analize_rslt) = @_;
				$analizedata->{$analizeid} = $analize_rslt;
				app->log->debug("... subprocess <".$analizeid."> finished");
			}
		);
	}
};

=item B</auth/getKey>

Get the key to be used to encrypt password before sending.
=cut

=item B</auth/login>

Authenticate to the ZyPP Monitor with specified login and password.
=cut

=item B</auth/getInfo>

Returns the information about current session authentication.
=cut
any '/auth/:op' => [op => ['getKey', 'login', 'getInfo']] => sub {
	my $c = shift;
	$c->res->headers->access_control_allow_origin('*');
	$c->res->headers->add('Access-Control-Allow-Headers' =>
		'x-zyppmon-auth-token, Origin, Pragma, Cache-Control, X-Qooxdoo-Response-Type');
	if ( $c->req->method eq 'OPTIONS' ) {
		$c->render(data => '', status => 200);
		return;
	}
	my $op = $c->param('op');
	my $rFP = getRequestFP($c);
	if ( $op eq 'getKey' ) {
		$c->render(json => {authKey => getCurrentAuthKey($rFP)});
	} elsif ( $op eq 'login' )  {
		my $jauth = $c->req->param('jauth');
		if ( $jauth ) {
			$c->render(json => authLogin($jauth, $rFP));
		} else {
			$c->render(json => {status => "error", error => "NOT_SPECIFIED",
							msg => "Authentication data was not specified."});
		}
	} else {
		checkAuth($c, 1);
	}
};

=item B</dump>

Get the full dump of internal data structure

=cut
get '/dump' => sub {
	my $c = shift;
	return unless checkAuth($c);
	$c->render(json => \%pkgs);
};

# Process /qx/* static files
get '/webapp/*' => sub {
	my $c = shift;
	return if redirectForceSecure($c);
	my $path = $c->req->url;
	$path =~ s/\/webapp\///;
	$c->reply->static($path);
};

# Process all other static files
# show index.html on requesting /webapp/
# if route is not found redirect to /webapp/
any '/:px' => [px => qr/.*/] => sub {
	my $c = shift;
	return if redirectForceSecure($c);
	my $px = $c->param('px');
	if ( $px =~ m!\Awebapp(/index.*|/|)\z! ) {
		$c->reply->static('index.html');
	} elsif ( $px =~ m!\Awebapp/(.*)! ) {
		my $sp = $1;
		$c->reply->static($sp);
	} elsif ( $px =~ m!\Asource/(.*)! ) {
		my $sp = $1;
		$c->reply->static($sp);
	} else {
		$c->redirect_to('/webapp/');
	}
};

# Starting Mojolicious WEB application
app->log->info("Starting web service...");
my @listen;
if ( LISTEN_PORT ) {
	push(@listen, 'http://*:'.LISTEN_PORT);
}
if ( LISTEN_SECURE && LISTEN_SECURE_PORT ) {
	push(@listen, 'https://*:'.LISTEN_SECURE_PORT.
		(( SECURE_CERT gt '' && SECURE_KEY gt '' ) ? '?cert='.SECURE_CERT.'&key='.SECURE_KEY : ''));
}
my $daemon = Mojo::Server::Daemon->new(app => app,
		listen => \@listen);
$daemon->start;

# Call "one_tick" repeatedly from the alien environment
Mojo::IOLoop->one_tick while 1;

END {
	if ( defined($tthread) ) {
		app->log->debug("Stopping zypper history reading thread...");
		{ lock($history_ctrl); $history_ctrl |= HIST_STOP; cond_signal($history_ctrl); }
		$tthread->join();
		app->log->debug("... done");
	}
};

=head1 COPYRIGHT

Copyright 2017-2018 Victor Zhestkov.

=head1 AUTHORS

Zypper monitor was developed by Victor Zhestkov <vzhestkov@gmail.com>

=cut
