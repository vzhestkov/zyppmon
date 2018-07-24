#!/usr/bin/perl

use strict;
use warnings;
use utf8;
use open ':encoding(UTF-8)';
use Storable qw(store retrieve);

use constant {
	CHG_UPGRADE		=> 1,
	CHG_DOWNGRADE	=> 2,
	CHG_REFRESH		=> 4,
	CHG_VCHANGE		=> 8,
	CHG_DCHANGE		=> 16,
	CHG_SIGCHANGE	=> 32,
	CHG_REMOVE		=> 64
};

my $interactive = -t STDIN && -t STDOUT;

my $out_file = '/var/lib/rpmverify.state';

select((select(STDOUT), $| = 1)[0]);

my %flags = (
	'.' => {ms => 'test passed'},
	'?' => {ms => 'test couldn\'t be performed'},
	'S' => {ix => 0, nm => 'file size',					ms => 'file size differs'},
	'M' => {ix => 1, nm => 'mode',						ms => 'mode differs (includes permissions and file type)'},
	'5' => {ix => 2, nm => 'digest (formerly MD5 sum)',	ms => 'digest (formerly MD5 sum) differs'},
	'D' => {ix => 3, nm => 'device major/minor number',	ms => 'device major/minor number mismatch'},
	'L' => {ix => 4, nm => 'readlink(2) path',			ms => 'readlink(2) path mismatch'},
	'U' => {ix => 5, nm => 'user ownership',			ms => 'user ownership differs'},
	'G' => {ix => 6, nm => 'group ownership',			ms => 'group ownership differs'},
	'T' => {ix => 7, nm => 'mtime',						ms => 'mtime differs'},
	'P' => {ix => 8, nm => 'capabilities',				ms => 'capabilities differ'}
);
my @flags_o = sort { $flags{$a}->{ix} <=> $flags{$b}->{ix} } grep { defined($flags{$_}->{ix}) } keys(%flags);
my $flags_s = join('', keys(%flags));
my $flags_rx = qr![$flags_s]{9}!x;
my %file_type = (
	'c' => 'config file',
	'd' => 'documentation file',
	'g' => 'ghost file',
	'l' => 'license file',
	'r' => 'readme file',
);

my @tests = (
	{	cl => 4,
		name => 'URGENT',
		test => sub {
			my ($rpm, $file, $flags, $type, $msg, $ao) = @_;
			$type = '' unless defined($type);
			return 0 unless $file;
			if ( $flags =~ /[S5]/ ) {
				my $md = (stat($file))[2];
				if ( $md & 0111 ) {
					${$ao} = sprintf("WARNING!!!: Executable file was changed: %s\n", $file) if defined $ao;
					return 1;
				}
			}
			return 0;
		},
		list => []},
	{	cl => 3,
		name => 'HIGH',
		test => sub {
			my ($rpm, $file, $flags, $type, $msg) = @_;
			$type = '' unless defined($type);
			return 0 unless $file;
			return 0 if ($type ne 'c' || $type eq '') && ($flags !~ /[S5UG]/) && ($flags =~ /M/);
			return 1 if ($type ne 'c' || $type eq '') && $flags =~ /[SM5UG]/;
			return 0;
		},
		list => []},
	{	cl => 2,
		name => 'MEDIUM',
		test => sub {
			my ($rpm, $file, $flags, $type, $msg) = @_;
			$type = '' unless defined($type);
			return 0 unless $file;
			return 1 if ($type ne 'c') && $flags =~ /[SM5UG]/;
			return 0;
		},
		list => []},
	{	cl => 1,
		name => 'LOW',
		test => sub {
			my ($rpm, $file, $flags, $type, $msg) = @_;
			return 1 if $msg && $msg =~ /Unsatisfied dependencies/;
			return 0 unless $file;
			return 1 if $flags eq 'missing';
			return 1 if $flags !~ /[SM5UG]/ && $flags =~ /[TP]/;
			return 0;
		},
		list => []},
);

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
		if ( (($ax, $ay) = $a =~ /\A([^\-]+)(?:\-(.*)|)\z/) && (($bx, $by) = $b =~ /\A([^\-]+)(?:\-(.*)|)\z/) && (defined($ay) || defined($by)) ) {
			# Splitting VERSION-RELEASE stings
			enque_cmp($q, [$ay, $by], [$ax, $bx]);
		} elsif ( (($ax, $ay) = $a =~ /\A([^\.]+)(?:\.(.*)|)/) && (($bx, $by) = $b =~ /\A([^\.]+)(?:\.(.*)|)/) && (defined($ay) || defined($by)) ) {
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
		} elsif ( $a eq "" || $b eq "" ) {
			# Compare blank an non blank components. Non blank wins
			return $a eq "" ? -1 : 1;
		} else {
			# It shouldn't happen in real life, but...
			return $a gt $b ? 1 : -1;
		}
	}
	return 0;
}

sub getFlagsDescr {
	my $f = shift;
	my @a = split('', $f);
	for ( my $i = 0; $i < @a; $i++ ) {
		if ( defined($flags{$a[$i]}) ) {
			if ( defined($flags{$a[$i]}->{ix}) ) {
				$a[$i] = $flags{$a[$i]}->{ms};
			} elsif ( $a[$i] ne '.' ) {
				$a[$i] = $flags{$flags_o[$i]}->{nm}.' '.$flags{$a[$i]}->{ms};
			} else {
				$a[$i] = undef;
			}
		} else {
			$a[$i] = undef;
		}
	}
	return grep { defined($_) } @a;
}

my $pkgs = {};
my $chgs = [];
my $stat = {
	vendors => {},
	distrs => {},
	installed => 0,
	removed => 0
};

eval {
	$pkgs = retrieve($out_file);
};

my @p = ('-', '\\', '|', '/');
my $p = @p;

print("Reading RPMs list...  ");
my $i = 0;
my $ts = time();
open(my $rpmqa_fh, '-|', 'rpm', '-qa', '--qf', '%{NVRA}|%{ARCH}|%{NAME}|%{V}|%{R}|%{INSTALLTIME}|%{VENDOR}|%{DISTRIBUTION}|%{SIGMD5}\n');
while ( my $l = <$rpmqa_fh> ) {
	$l =~ s/[\r\n]+\z//;
	my ($nvra, $arch, $name, $ver, $rel, $installtime, $vendor, $distr, $sig) = split(/\|/, $l);
	$installtime = int($installtime);
	$pkgs->{$arch} = {} unless defined($pkgs->{$arch});
	if ( !defined($pkgs->{$arch}{$name}) ) {
		$pkgs->{$arch}{$name} = {nvra => $nvra, ver => $ver, rel => $rel, it => $installtime,
								vendor => $vendor, distr => $distr, ts => $ts, sig => $sig};
	} elsif ( ref($pkgs->{$arch}{$name}) eq 'HASH' && $pkgs->{$arch}{$name}{ts} == $ts ) {
		my $old_dt = $pkgs->{$arch}{$name};
		$pkgs->{$arch}{$name} = [];
		push(@{$pkgs->{$arch}{$name}}, $old_dt);
		push(@{$pkgs->{$arch}{$name}}, {nvra => $nvra, ver => $ver, rel => $rel, it => $installtime,
										vendor => $vendor, distr => $distr, ts => $ts, sig => $sig});
	} elsif ( ref($pkgs->{$arch}{$name}) eq 'HASH' ) {
		my $vcr = vrcmp($ver, $rel, $pkgs->{$arch}{$name}{ver}, $pkgs->{$arch}{$name}{rel});
		my $op = 0;
		$op |= CHG_UPGRADE if $vcr == 1;
		$op |= CHG_DOWNGRADE if $vcr == -1;
		$op |= CHG_REFRESH if $vcr == 0 && $installtime != $pkgs->{$arch}{$name}{it};
		$op |= CHG_VCHANGE if $vendor ne $pkgs->{$arch}{$name}{vendor};
		$op |= CHG_DCHANGE if $distr ne $pkgs->{$arch}{$name}{distr};
		$op |= CHG_SIGCHANGE if $sig ne $pkgs->{$arch}{$name}{sig};
		$pkgs->{$arch}{$name}{ts} = $ts;
		push(@{$chgs}, {name => $name, arch => $arch, op => $op, ver => $ver, rel => $rel,
				it => $installtime, vendor => $vendor, distr => $distr, o_ver => $pkgs->{$arch}{$name}{ver}, o_rel => $pkgs->{$arch}{$name}{rel},
				o_it => $pkgs->{$arch}{$name}{it}, o_vendor => $pkgs->{$arch}{$name}{vendor}, o_distr => $pkgs->{$arch}{$name}{distr},
				sig => $sig, o_sig => $pkgs->{$arch}{$name}{sig}}) if $op;
	} elsif ( ref($pkgs->{$arch}{$name}) eq 'ARRAY' ) {
		my $mf = 0;
		foreach my $rpm ( @{$pkgs->{$arch}{$name}} ) {
			my $vcr = vrcmp($ver, $rel, $rpm->{ver}, $rpm->{rel});
			if ( $vcr == 0 ) {
				$rpm->{ts} = $ts;
				$mf = 1;
				my $op = 0;
				$op |= CHG_REFRESH if $vcr == 0 && $installtime != $rpm->{it};
				$op |= CHG_VCHANGE if $vendor ne $rpm->{vendor};
				$op |= CHG_DCHANGE if $distr ne $rpm->{distr};
				$op |= CHG_SIGCHANGE if $sig ne $rpm->{sig};
				$rpm->{ts} = $ts;
				push(@{$chgs}, {name => $name, arch => $arch, op => $op, ver => $ver, rel => $rel,
						it => $installtime, vendor => $vendor, distr => $distr, o_ver => $rpm->{ver}, o_rel => $rpm->{rel},
						o_it => $rpm->{it}, o_vendor => $rpm->{vendor}, o_distr => $rpm->{distr},
						sig => $sig, o_sig => $rpm->{sig}}) if $op;
				last;
			}
		}
		push(@{$pkgs->{$arch}{$name}}, {nvra => $nvra, ver => $ver, rel => $rel,
				it => $installtime, vendor => $vendor, distr => $distr, ts => $ts, sig => $sig}) unless $mf;
	}
	print("\b".$p[$i % $p]) if ( $interactive && (!($i % ($p*8+1))) );
	$i++;
}
$stat->{installed} = $i;
close($rpmqa_fh);
print(($interactive ? "\b" : "")."[done]\n");

my $cnt = 0;
foreach my $arch ( keys(%{$pkgs}) ) {
	foreach my $name ( keys(%{$pkgs->{$arch}}) ) {
		if ( ref($pkgs->{$arch}{$name}) eq 'ARRAY' ) {
			foreach my $rpm ( @{$pkgs->{$arch}{$name}} ) {
				if ( $rpm->{ts} != $ts ) {
					$stat->{removed}++;
					push(@{$chgs}, {name => $name, arch => $arch, op => CHG_REMOVE,
							o_ver => $rpm->{ver}, o_rel => $rpm->{rel},
							o_it => $rpm->{it}, o_vendor => $rpm->{vendor},
							o_distr => $rpm->{distr}});
				} else {
					$stat->{vendors}{$rpm->{vendor}}++;
					$stat->{distrs}{$rpm->{distr}}++;
					$cnt++;
				}
			}
		} else {
			if ( $pkgs->{$arch}{$name}{ts} != $ts ) {
				$stat->{removed}++;
				push(@{$chgs}, {name => $name, arch => $arch, op => CHG_REMOVE,
						o_ver => $pkgs->{$arch}{$name}{ver}, o_rel => $pkgs->{$arch}{$name}{rel},
						o_it => $pkgs->{$arch}{$name}{it}, o_vendor => $pkgs->{$arch}{$name}{vendor},
						o_distr => $pkgs->{$arch}{$name}{distr}});
			} else {
				$stat->{vendors}{$pkgs->{$arch}{$name}{vendor}}++;
				$stat->{distrs}{$pkgs->{$arch}{$name}{distr}}++;
				$cnt++;
			}
		}
	}
}

print("Starting RPM verification...\n");
$i = 0;
foreach my $arch ( keys(%{$pkgs}) ) {
	foreach my $name ( keys(%{$pkgs->{$arch}}) ) {
		my $a = [];
		if ( ref($pkgs->{$arch}{$name}) eq 'HASH' ) {
			push(@{$a}, $pkgs->{$arch}{$name});
		} else {
			$a = $pkgs->{$arch}{$name};
		}
		foreach my $rpm (@{$a}) {
			next if ($rpm->{ts} != $ts);
			my $nvra = $rpm->{nvra};
			my $msg = '['.sprintf('%5.2f', ($i/$cnt)*100).'%] '.$nvra;
			my $nl = length($msg);
			print($msg) if ( $interactive );
			my $out = "";
			my $ot = "";
			open(my $rpmv_fh, '-|', 'rpm', '-V', $nvra);
			my $rcl = 0;
			while ( my $vl = <$rpmv_fh> ) {
				my $ao = "";
				if ( my($fg, $ft, $fl) = $vl =~ /\A($flags_rx|missing)\s+(?:([cdglr]) |)(.+)/ ) {
					my($nf, $mr);
					if ( ($nf, $mr) = $fl =~ /\A(.+?)( \(Permission denied\)|)\z/ ) {
						$fl = $nf;
					}
					$rpm->{files} = [] unless defined($rpm->{files});
					my $finf = {file => $fl, flags => $fg, type => $ft};
					if ( $fg =~ /[S5]/ && open(my $md5_fh, '-|', 'md5sum', $fl) ) {
						my $l = <$md5_fh>;
						if ( $l && $l =~ /\A(\w+)\s+/ ) {
							$finf->{md5} = $1;
						}
						close($md5_fh);
					}
					push(@{$rpm->{files}}, $finf);
					my $cl = 0;
					foreach my $ct ( @tests ) {
						my $rv = &{$ct->{test}}($rpm, $fl, $fg, $ft, undef, \$ao);
						if ( $rv ) {
							$cl = $ct->{cl};
							last;
						}
					}
					$rcl = $cl if ($cl > $rcl);
					if ( $fg eq 'missing' ) {
						$out .= $fl."\n\tfile is missing".($mr ? $mr : "").($ft ? " <".$file_type{$ft}.">" : "")."\n"
					} else {
						$out .= $fl."\n\t[".$fg."]: ".join('; ', getFlagsDescr($fg)).($ft ? " <".$file_type{$ft}.">" : "")."\n";
						$out .= "\t".$ao."\n" if ( $ao gt '' );
					}
				} else {
					$out .= $vl;
					$ot .= $vl;
				}
			}
			close($rpmv_fh);
			if ( $ot ) {
				foreach my $ct ( @tests ) {
					my $cl = &{$ct->{test}}($rpm, undef, undef, undef, $ot);
					if ( $cl ) {
						$rcl = $ct->{cv} if ($ct->{cv} > $rcl);
						last;
					}
				}
			}
			$rpm->{cl} = $rcl;
			$rpm->{ot} = $ot;
			if ( $rcl ) {
				foreach my $ct ( @tests ) {
					if ( $rcl == $ct->{cl} ) {
						$ct->{cnt}++;
						push(@{$ct->{list}}, $rpm);
						last;
					}
				}
			}
			print("\r".(' 'x$nl)."\r") if ( $interactive );
			if ( $? ) {
				print($nvra);
				print(":\n".$out."\n");
			}
			$i++;
		}
	}
}

print("\nSUMMARY:\n");
printf("%20s: %d\n", "Packages verified", $cnt);
my $dtls = "";
print("Risk score:\n");
foreach my $ct ( @tests ) {
	printf("%20s: %d\n", $ct->{name}, $ct->{cnt} ? $ct->{cnt} : 0);
	if ( $ct->{cnt} && scalar(@{$ct->{list}}) ) {
		my $idnt = ' 'x(length($ct->{name})+1);
		$dtls .= "\n".$ct->{name}.":\n";
		foreach my $rpm (@{$ct->{list}}) {
			$dtls .= $idnt.$rpm->{nvra}."\n";
		}
	}
}
print($dtls);

print("\nVENDORS:\n");
foreach my $vendor ( sort { $stat->{vendors}{$b} <=> $stat->{vendors}{$a} } keys(%{$stat->{vendors}}) ) {
	printf("%5d - %s\n", $stat->{vendors}{$vendor}, $vendor);
}

print("\nDISTRIBUTIONS:\n");
foreach my $distr ( sort { $stat->{distrs}{$b} <=> $stat->{distrs}{$a} } keys(%{$stat->{distrs}}) ) {
	printf("%5d - %s\n", $stat->{distrs}{$distr}, $distr);
}

store($pkgs, $out_file) or printf("Unable to store packages state to the file: %s\n", $out_file);

if ( $interactive ) {
	print("Press ENTER to continue.\n");
	<STDIN>;
}
