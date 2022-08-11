#!/usr/bin/env python

import pathlib
import os
import shutil
import sys


def main(path_to_extension):
    target_directory = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    'resources')
    if not os.path.exists(path_to_extension):
        raise Exception(f'{path_to_extension} does not exist')
    for root, dir, files in os.walk(path_to_extension):
        for f in files:
            if f == 'language-configuration.json':
                language_configuration = os.path.join(root, f)
                language_directory = os.path.join(
                    target_directory,
                    pathlib.Path(root).relative_to(path_to_extension))
                if not os.path.exists(language_directory):
                    os.mkdir(language_directory)
                print(
                    f'Copy: {language_configuration} => {language_directory}')
                shutil.copy(language_configuration, language_directory)


if __name__ == '__main__':
    main(sys.argv[1])
